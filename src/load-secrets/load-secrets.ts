import type {
  DescribeSecretResponse,
  Tag,
} from "@aws-sdk/client-secrets-manager"
import {
  CreateSecretCommand,
  DescribeSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  RemoveRegionsFromReplicationCommand,
  ReplicateSecretToRegionsCommand,
  ResourceNotFoundException,
  RestoreSecretCommand,
  SecretsManagerClient,
  TagResourceCommand,
  UntagResourceCommand,
} from "@aws-sdk/client-secrets-manager"
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts"
import type { Options } from "read"
import { read } from "read"
import type { CLIReporter } from "../cli/reporter"
import { createReporter } from "../cli/reporter"

import type { JsonSecret, Secret, SecretGroup } from "./types"

class LoadSecrets {
  private readonly smClientForRegions: Record<string, SecretsManagerClient> = {}
  private readonly stsClient: STSClient

  private readonly reporter: CLIReporter
  private readonly silent: boolean

  constructor(props: { reporter: CLIReporter; silent: boolean }) {
    this.stsClient = new STSClient({
      region: "eu-west-1",
    })
    this.reporter = props.reporter
    this.silent = props.silent
  }

  private getSmClient(region: string): SecretsManagerClient {
    if (!this.smClientForRegions[region]) {
      this.smClientForRegions[region] = new SecretsManagerClient({
        region,
      })
    }

    return this.smClientForRegions[region]
  }

  async getInput(options: Options): Promise<string> {
    return read(options)
  }

  async getSecretDetails(
    client: SecretsManagerClient,
    secretId: string,
  ): Promise<DescribeSecretResponse | null> {
    try {
      return await client.send(
        new DescribeSecretCommand({ SecretId: secretId }),
      )
    } catch (e) {
      if (e instanceof ResourceNotFoundException) {
        return null
      }

      throw e
    }
  }

  async handleStringUpdate() {
    return await this.getInput({
      prompt: "Enter value (Ctrl+C to abort): ",
      silent: this.silent,
    })
  }
  async handleJsonUpdate(secret: JsonSecret) {
    this.reporter.log("The secret is of type JSON with these expected fields:")
    for (const field of secret.fields) {
      const key = typeof field === "string" ? field : field.key
      const desc =
        typeof field === "string"
          ? ""
          : field.description
            ? ` (${field.description})`
            : ""
      this.reporter.log(`  - ${key}${desc}`)
    }

    this.reporter.log("")

    // TODO: Ability to specify full json value as one line.

    const collectedValues: Record<string, string | null> = {}
    for (const field of secret.fields) {
      const key = typeof field === "string" ? field : field.key

      this.reporter.log(`Field: ${this.reporter.format.greenBright(key)}`)

      if (typeof field !== "string" && field.example != null) {
        this.reporter.log(
          `Example: ${this.reporter.format.magentaBright(field.example)}`,
        )
      }

      collectedValues[key] = await this.getInput({
        prompt: "Enter value (Ctrl+C to abort): ",
        silent: this.silent,
      })

      this.reporter.log("")
    }

    return JSON.stringify(collectedValues, undefined, "  ")
  }

  getFullName(secretGroup: SecretGroup, secret: Secret) {
    return `${secretGroup.namePrefix}${secret.name}`
  }

  async syncTags(
    client: SecretsManagerClient,
    secret: DescribeSecretResponse,
    tags: Tag[],
  ) {
    const keysToRemove = secret
      .Tags!.filter(
        (existingTag) => !tags.some((it) => it.Key! === existingTag.Key!),
      )
      .map((it) => it.Key!)

    if (keysToRemove.length > 0) {
      this.reporter.log(`Removing obsolete tags: ${keysToRemove.join(", ")}`)
      await client.send(
        new UntagResourceCommand({
          SecretId: secret.ARN!,
          TagKeys: keysToRemove,
        }),
      )
    }

    const tagsToUpdate = tags.filter((expectedTag) => {
      const existing = secret.Tags!.find((it) => it.Key! === expectedTag.Key!)

      // biome-ignore lint/suspicious/noDoubleEquals: Carryover from eslint
      return existing == null || existing.Value != expectedTag.Value
    })

    if (tagsToUpdate.length > 0) {
      this.reporter.log(
        `Storing tags: ${tagsToUpdate.map((it) => it.Key!).join(", ")}`,
      )
      await client.send(
        new TagResourceCommand({
          SecretId: secret.ARN!,
          Tags: tagsToUpdate,
        }),
      )
    }
  }

  async getSecretValue(client: SecretsManagerClient, secretId: string) {
    const result = await client.send(
      new GetSecretValueCommand({
        SecretId: secretId,
      }),
    )

    if (result.SecretString == null) {
      throw new Error("Missing SecretString (is it a binary?)")
    }

    return result.SecretString
  }

  async handleUpdate(secretGroup: SecretGroup, secret: Secret) {
    const client = this.getSmClient(secretGroup.region)

    const fullName = this.getFullName(secretGroup, secret)
    const describeSecret = await this.getSecretDetails(client, fullName)

    this.reporter.log(`Secret: ${this.reporter.format.greenBright(fullName)}`)

    if (describeSecret == null) {
      this.reporter.log("The secret does not already exist and will be created")
    } else {
      this.reporter.log("Current value:")
      this.reporter.log(
        this.reporter.format.yellowBright(
          (await this.getSecretValue(client, fullName)).replace(/^/gm, "  "),
        ),
      )
    }

    this.reporter.log("")

    let secretValue: string

    if (secret.type === "json") {
      try {
        secretValue = await this.handleJsonUpdate(secret)
      } catch (e) {
        if (e instanceof Error && e.message === "canceled") {
          this.reporter.log("Aborted")
          return
        }
        throw e
      }
    } else if (secret.type === "string") {
      secretValue = await this.handleStringUpdate()
    } else {
      throw new Error("Unsupported type")
    }

    this.reporter.log("Storing secret value:")
    this.reporter.log(
      this.reporter.format.yellowBright(secretValue.replace(/^/gm, "  ")),
    )

    const tags: Tag[] = [
      {
        Key: "Source",
        Value: "load-secrets script",
      },
    ]

    let arn: string
    let version: string
    let newReplicaRegions: string[]
    let removedReplicaRegions: string[] = []

    if (describeSecret == null) {
      newReplicaRegions = secret.replicaRegions ?? []
      const createResult = await client.send(
        new CreateSecretCommand({
          Name: fullName,
          AddReplicaRegions: secret.replicaRegions
            ? secret.replicaRegions.map((replicaRegion) => ({
                Region: replicaRegion,
              }))
            : undefined,
          Description: "Created by load-secrets",
          SecretString: secretValue,
          Tags: tags,
        }),
      )

      if (createResult.VersionId == null) {
        throw new Error("Expected versionId")
      }

      arn = createResult.ARN!
      version = createResult.VersionId
    } else {
      if (describeSecret.DeletedDate != null) {
        await client.send(
          new RestoreSecretCommand({
            SecretId: fullName,
          }),
        )
      }

      const updateResult = await client.send(
        new PutSecretValueCommand({
          SecretId: fullName,
          SecretString: secretValue,
        }),
      )
      const currentReplicaRegions =
        describeSecret.ReplicationStatus?.map(
          (replicationStatus) => replicationStatus.Region,
        ) ?? []
      newReplicaRegions =
        secret.replicaRegions?.filter(
          (region) => !currentReplicaRegions.includes(region),
        ) ?? []
      removedReplicaRegions = currentReplicaRegions
        .filter((region): region is string => !!region && true)
        .filter((region) => !(secret.replicaRegions || []).includes(region))
      if (newReplicaRegions.length > 0) {
        await client.send(
          new ReplicateSecretToRegionsCommand({
            SecretId: fullName,
            AddReplicaRegions: newReplicaRegions.map((region) => ({
              Region: region,
            })),
          }),
        )
      }
      if (removedReplicaRegions.length > 0) {
        await client.send(
          new RemoveRegionsFromReplicationCommand({
            SecretId: fullName,
            RemoveReplicaRegions: removedReplicaRegions,
          }),
        )
      }

      if (updateResult.VersionId == null) {
        throw new Error("Expected versionId")
      }

      await this.syncTags(client, describeSecret, tags)

      arn = updateResult.ARN!
      version = updateResult.VersionId
    }

    this.reporter.log("")
    this.reporter.log("Secret stored:")
    this.reporter.log(`ARN: ${this.reporter.format.greenBright(arn)}`)
    this.reporter.log(`Version: ${this.reporter.format.greenBright(version)}`)
    if (newReplicaRegions.length > 0) {
      this.reporter.log(
        `Read replicas added to regions: ${newReplicaRegions
          .map((r) => this.reporter.format.greenBright(r))
          .join(", ")}`,
      )
    }
    if (removedReplicaRegions.length > 0) {
      this.reporter.log(
        `Read replicas removed from regions: ${removedReplicaRegions
          .map((r) => this.reporter.format.redBright(r))
          .join(", ")}`,
      )
    }
  }

  checkSecretGroup(secretGroup: SecretGroup) {
    if (
      !secretGroup.namePrefix.startsWith("/") ||
      !secretGroup.namePrefix.endsWith("/")
    ) {
      throw new Error(
        `namePrefix should start and end with /. Current value: ${secretGroup.namePrefix}`,
      )
    }
  }

  getSecretDescription(details: DescribeSecretResponse | null) {
    return details == null
      ? "not yet created"
      : details?.DeletedDate != null
        ? `scheduled for deletion ${details.DeletedDate.toISOString()}`
        : `last changed ${details.LastChangedDate?.toISOString() ?? "unknown"}`
  }

  /**
   * Returns false if aborted.
   */
  async selectAndUpdate(secretGroups: SecretGroup[]): Promise<boolean> {
    const secrets: { secretGroup: SecretGroup; secret: Secret }[] = []

    this.reporter.log("Select secret to write:")
    this.reporter.log("")

    for (const secretGroup of secretGroups) {
      this.reporter.log(
        `${secretGroup.description} (prefix: ${secretGroup.namePrefix})`,
      )

      for (let i = 0; i < secretGroup.secrets.length; i++) {
        const offset = secrets.length
        const secret = secretGroup.secrets[i]

        secrets.push({
          secret: secret,
          secretGroup,
        })

        const client = this.getSmClient(secretGroup.region)
        const details = await this.getSecretDetails(
          client,
          this.getFullName(secretGroup, secret),
        )
        const desc = this.getSecretDescription(details)

        this.reporter.log(`  (${offset}) ${secret.name} (${desc})`)
      }
      this.reporter.log("")
    }

    let index: number
    try {
      const answer = await this.getInput({
        prompt: "Enter index (or enter to quit): ",
      })
      if (answer.trim() === "") {
        return false
      }

      index = Number.parseInt(answer)
      if (!secrets[index]) {
        throw new Error()
      }
    } catch (_) {
      this.reporter.warn("Secret not found - aborting")
      return false
    }

    this.reporter.log("")
    await this.handleUpdate(secrets[index].secretGroup, secrets[index].secret)
    this.reporter.log("")

    return true
  }

  async process(secretGroups: SecretGroup[]) {
    this.reporter.info("Checking account for current credentials")
    this.reporter.info(
      "If any error is given, make sure you have valid credentials active",
    )
    const currentAccount = await this.stsClient.send(
      new GetCallerIdentityCommand({}),
    )

    this.reporter.info(`Running for account ${currentAccount.Account!}`)
    this.reporter.log("")

    const matchedSecretGroups = secretGroups.filter(
      (it) => it.accountId === currentAccount.Account!,
    )
    if (matchedSecretGroups.length === 0) {
      this.reporter.error("No secrets specified for this account - aborting")
      return
    }

    for (const secretGroup of matchedSecretGroups) {
      this.checkSecretGroup(secretGroup)
    }

    // eslint-disable-next-line no-empty
    while (await this.selectAndUpdate(matchedSecretGroups)) {}
  }
}

/**
 * Load secrets interactively into Secrets Manager.
 */
export function loadSecretsCli(props: { secretGroups: SecretGroup[] }): void {
  const loadSecrets = new LoadSecrets({
    reporter: createReporter({}),
    // For now, we show the secrets, so that we get positive feedback that the value
    // is correctly entered.
    silent: false,
  })

  loadSecrets.process(props.secretGroups).catch((error) => {
    console.error(error.stack || error.message || error)
    process.exitCode = 1
  })
}
