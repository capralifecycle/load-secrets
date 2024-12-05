# load-secrets

Library for loading secrets into AWS Secrets Mananager from a configuration file.

## Installation

```bash
$ npm install @liflig/load-secrets
```

## Usage

### 1. Create a script for loading secrets into AWS Secrets Manager

Create a script in your project for loading project secrets into AWS Secrets Manager.

Example: `load-secrets-demo-service.ts`

```ts
// 1. Import the library
import { loadSecrets } from "@capraconsulting/load-secrets";

// 2. Define the secrets
const demoServiceApiKey: loadSecrets.Secret = {
    name: "demo-service-api-key",
    description: "API key for the demo service",
    type: "string"
}

// 3. Assign the secrets to SecretGroups (collections of associations between secrets and accounts)
const secretGroups: loadSecrets.SecretGroup[] = [
  {
    accountId: "123412341234",
    region: "eu-west-1",
    description: "dev",
    namePrefix: "/dev/demo-svc/",
    secrets: [demoServiceApiKey]
  },
  {
    accountId: "234523452345",
    region: "eu-west-1",
    description: "staging",
    namePrefix: "/staging/demo-svc/",
    secrets: [demoServiceApiKey]
  }
];

// 4. Load the secrets into AWS Secrets Manager
loadSecrets.loadSecretsCli({ secretGroups })
```

### 2. Assume an AWS role with the required permissions

Example: `aws-vault exec team-squirrel-demo-service`

Say, for example, that this command assumes AWS Account 123412341234.

### 3. Run the script

```bash
$ ./load-secrets-demo-service.ts
info Checking account for current credentials
info If any error is given, make sure you have valid credentials active
info Running for account 123412341234

Select secret to write:

dev (prefix: /dev/demo-svc/)
  (0) demo-service-api-key (not yet created)

Enter index (or enter to quit): 0

Secret: /dev/demo-svc/demo-service-api-key 
The secret does not already exist and will be created

Enter value (Ctrl+C to abort): test
Storing secret value:
  test

Secret stored:
ARN: arn:aws:secretsmanager:eu-west-1:123412341234:secret:/dev/demo-svc/demo-service-api-key-UIqJ8N
Version: bdbf33c1-eda8-4aa1-b744-7c2006eae338

Select secret to write:

dev (prefix: /dev/demo-svc/)
  0) test-secret-delete-me (last changed 2024-12-03T13:50:44.237Z)

Enter index (or enter to quit):
```
