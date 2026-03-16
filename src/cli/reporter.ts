import readline from "node:readline"
import { styleText } from "node:util"

const CLEAR_WHOLE_LINE = 0

type StyleFn = (text: string) => string

export interface Format {
  red: StyleFn
  yellow: StyleFn
  blue: StyleFn
  greenBright: StyleFn
  magentaBright: StyleFn
  yellowBright: StyleFn
  redBright: StyleFn
}

const format: Format = {
  red: (text) => styleText("red", text),
  yellow: (text) => styleText("yellow", text),
  blue: (text) => styleText("blue", text),
  greenBright: (text) => styleText("greenBright", text),
  magentaBright: (text) => styleText("magentaBright", text),
  yellowBright: (text) => styleText("yellowBright", text),
  redBright: (text) => styleText("redBright", text),
}

export function createReporter(argv: Record<string, unknown>): CLIReporter {
  return new CLIReporter({
    verbose: !!argv.verbose,
    nonInteractive: !!argv.nonInteractive,
  })
}

function clearLine(stdout: NodeJS.WriteStream) {
  readline.clearLine(stdout, CLEAR_WHOLE_LINE)
  readline.cursorTo(stdout, 0)
}

export class CLIReporter {
  public constructor(
    opts: {
      nonInteractive?: boolean
      verbose?: boolean
    } = {},
  ) {
    this.nonInteractive = !!opts.nonInteractive
    this.isVerbose = !!opts.verbose
  }

  public stdout = process.stdout
  public stderr = process.stderr
  public nonInteractive: boolean
  public isVerbose: boolean
  public format: Format = format

  public error(msg: string): void {
    clearLine(this.stderr)
    this.stderr.write(`${this.format.red("error")} ${msg}\n`)
  }

  public log(msg: string): void {
    clearLine(this.stdout)
    this.stdout.write(`${msg}\n`)
  }

  public warn(msg: string): void {
    clearLine(this.stderr)
    this.stderr.write(`${this.format.yellow("warning")} ${msg}\n`)
  }

  public info(msg: string): void {
    clearLine(this.stdout)
    this.stdout.write(`${this.format.blue("info")} ${msg}\n`)
  }
}
