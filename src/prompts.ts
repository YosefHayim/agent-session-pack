import { createInterface } from 'node:readline/promises';
import type { ProviderAdapter } from './providers.js';

interface AskChoiceOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface AskChoiceQuestion {
  readonly message: string;
  readonly options: ReadonlyArray<AskChoiceOption>;
}

export async function askTerminalLine(message: string): Promise<string | null> {
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await terminal.question(message);
    return answer;
  } catch (error) {
    console.error({ message, error });
    return null;
  } finally {
    terminal.close();
  }
}

export async function askYes(message: string): Promise<boolean> {
  const answer = await askTerminalLine(`${message} [y/N] `);

  const isClosed = answer == null;

  if (isClosed) {
    return false;
  }

  const isYes = answer.trim().toLowerCase() == 'y';
  return isYes;
}

export async function askChoice(question: AskChoiceQuestion): Promise<string | null> {
  const enabledOptions = question.options.filter(isChoiceEnabled);
  writeChoices(question.message, enabledOptions);
  const answer = await askTerminalLine('> ');

  const isClosed = answer == null;

  if (isClosed) {
    return null;
  }

  const choiceIndex = readChoiceIndex(answer, enabledOptions.length);

  if (choiceIndex == null) {
    return null;
  }

  const pickedOption = enabledOptions[choiceIndex];

  if (pickedOption == null) {
    return null;
  }

  return pickedOption.value;
}

function isChoiceEnabled(option: AskChoiceOption): boolean {
  return option.disabled != true;
}

function writeChoices(message: string, enabledOptions: ReadonlyArray<AskChoiceOption>): void {
  process.stdout.write(`${message}\n`);

  for (const [index, option] of enabledOptions.entries()) {
    const choiceNumber = index + 1;
    process.stdout.write(`${choiceNumber}. ${option.label}\n`);
  }
}

function readChoiceIndex(answer: string, choiceCount: number): number | null {
  const pickedNumber = Number(answer.trim());
  if (Number.isFinite(pickedNumber) == false) {
    return null;
  }

  const choiceIndex = pickedNumber - 1;
  if (choiceIndex < 0) {
    return null;
  }

  if (choiceIndex >= choiceCount) {
    return null;
  }

  return choiceIndex;
}

const CANCELLED_ANSWER = Symbol('cancelled');

export interface PromptOption<Choice extends string> {
  readonly value: Choice;
  readonly label: string;
  readonly hint?: string;
  readonly disabled?: boolean;
}

interface PromptSpinner {
  start: (message?: string) => void;
  stop: (message?: string) => void;
  message: (message?: string) => void;
  error: (message?: string) => void;
}

export interface PromptAdapter {
  intro: (title?: string) => void;
  note: (message?: string, title?: string) => void;
  outro: (message?: string) => void;
  cancel: (message?: string) => void;
  isCancel: (answer: unknown) => answer is symbol;
  select: <Choice extends string>(question: {
    readonly message: string;
    readonly options: ReadonlyArray<PromptOption<Choice>>;
    readonly initialValue?: Choice;
  }) => Promise<Choice | symbol>;
  multiselect: <Choice extends string>(question: {
    readonly message: string;
    readonly options: ReadonlyArray<PromptOption<Choice>>;
    readonly initialValues?: ReadonlyArray<Choice>;
    readonly required?: boolean;
  }) => Promise<ReadonlyArray<Choice> | symbol>;
  text: (question: {
    readonly message: string;
    readonly initialValue?: string;
    readonly placeholder?: string;
    readonly validate?: (answer: string | undefined) => string | undefined;
  }) => Promise<string | symbol>;
  confirm: (question: {
    readonly message: string;
    readonly active?: string;
    readonly inactive?: string;
    readonly initialValue?: boolean;
  }) => Promise<boolean | symbol>;
  spinner: () => PromptSpinner;
}

export const terminalPromptAdapter: PromptAdapter = {
  cancel: writeCancel,
  confirm: askConfirm,
  intro: writeIntro,
  isCancel: isCancelledAnswer,
  multiselect: askMultiselect,
  note: writeNote,
  outro: writeOutro,
  select: askSelect,
  spinner: createSpinner,
  text: askText,
};

function isCancelledAnswer(answer: unknown): answer is symbol {
  return answer == CANCELLED_ANSWER;
}

function writeIntro(title?: string): void {
  if (title == null) {
    return;
  }

  process.stdout.write(`${title}\n`);
}

function writeNote(message?: string, title?: string): void {
  if (title != null) {
    process.stdout.write(`${title}\n`);
  }

  const isMessageMissing = message == null;

  if (isMessageMissing) {
    return;
  }

  process.stdout.write(`${message}\n`);
}

function writeOutro(message?: string): void {
  writeIntro(message);
}

function writeCancel(message?: string): void {
  const isMessageMissing = message == null;

  if (isMessageMissing) {
    return;
  }

  process.stderr.write(`${message}\n`);
}

async function askSelect<Choice extends string>(question: {
  readonly message: string;
  readonly options: ReadonlyArray<PromptOption<Choice>>;
}): Promise<Choice | symbol> {
  const pickedValue = await askChoice({
    message: question.message,
    options: question.options,
  });

  if (pickedValue == null) {
    return CANCELLED_ANSWER;
  }

  function isPickedOption(option: PromptOption<Choice>): boolean {
    return option.value == pickedValue;
  }

  const pickedOption = question.options.find(isPickedOption);

  const isOptionMissing = pickedOption == null;

  if (isOptionMissing) {
    return CANCELLED_ANSWER;
  }

  return pickedOption.value;
}

async function askMultiselect<Choice extends string>(question: {
  readonly message: string;
  readonly options: ReadonlyArray<PromptOption<Choice>>;
  readonly required?: boolean;
}): Promise<ReadonlyArray<Choice> | symbol> {
  const enabledOptions = question.options.filter(isPromptOptionEnabled);
  process.stdout.write(`${question.message}\n`);
  process.stdout.write('Enter numbers separated by commas.\n');

  for (const [index, option] of enabledOptions.entries()) {
    const choiceNumber = index + 1;
    process.stdout.write(`${choiceNumber}. ${option.label}\n`);
  }

  const answer = await askTerminalLine('> ');

  const isClosed = answer == null;

  if (isClosed) {
    return CANCELLED_ANSWER;
  }

  const pickedOptions = readPickedOptions(answer, enabledOptions);
  if (isRequiredSelectionEmpty(question.required, pickedOptions.length)) {
    return CANCELLED_ANSWER;
  }

  return pickedOptions;
}

function isPromptOptionEnabled<Choice extends string>(option: PromptOption<Choice>): boolean {
  return option.disabled != true;
}

function isRequiredSelectionEmpty(required: boolean | undefined, pickedCount: number): boolean {
  if (required != true) {
    return false;
  }

  return pickedCount == 0;
}

function readPickedOptions<Choice extends string>(
  answer: string,
  enabledOptions: ReadonlyArray<PromptOption<Choice>>,
): Choice[] {
  const tokens = answer.split(',');
  const pickedOptions: Choice[] = [];

  for (const token of tokens) {
    const pickedNumber = Number(token.trim());
    if (Number.isFinite(pickedNumber) == false) {
      continue;
    }

    const pickedOption = enabledOptions[pickedNumber - 1];

    const isOptionMissing = pickedOption == null;

    if (isOptionMissing) {
      continue;
    }

    pickedOptions.push(pickedOption.value);
  }

  return pickedOptions;
}

async function askText(question: {
  readonly message: string;
  readonly initialValue?: string;
  readonly placeholder?: string;
  readonly validate?: (answer: string | undefined) => string | undefined;
}): Promise<string | symbol> {
  const placeholder = question.placeholder ?? '';
  const promptLine = `${question.message} ${placeholder}`.trimEnd();
  const answer = await askTerminalLine(`${promptLine} `);

  const isClosed = answer == null;

  if (isClosed) {
    return CANCELLED_ANSWER;
  }

  const validate = question.validate;

  if (validate == null) {
    return answer;
  }

  const validationMessage = validate(answer);

  if (validationMessage == null) {
    return answer;
  }

  process.stdout.write(`${validationMessage}\n`);
  return askText(question);
}

async function askConfirm(question: { readonly message: string }): Promise<boolean | symbol> {
  const answer = await askTerminalLine(`${question.message} [y/N] `);

  const isClosed = answer == null;

  if (isClosed) {
    return CANCELLED_ANSWER;
  }

  const isYes = answer.trim().toLowerCase() == 'y';
  return isYes;
}

function createSpinner(): PromptSpinner {
  return {
    start: writeSpinnerStart,
    stop: writeSpinnerStop,
    message: writeSpinnerMessage,
    error: writeSpinnerError,
  };
}

function writeSpinnerStart(message?: string): void {
  writeSpinnerLine(message);
}

function writeSpinnerStop(message?: string): void {
  writeSpinnerLine(message);
}

function writeSpinnerMessage(message?: string): void {
  writeSpinnerLine(message);
}

function writeSpinnerError(message?: string): void {
  writeSpinnerLine(message);
}

function writeSpinnerLine(message: string | undefined): void {
  const isMessageMissing = message == null;

  if (isMessageMissing) {
    return;
  }

  process.stderr.write(`${message}\n`);
}

export interface SpinnerTaskRequest<Produced> {
  readonly prompts: PromptAdapter;
  readonly startMessage: string;
  readonly stopMessage: string;
  readonly task: () => Promise<Produced>;
}

export async function runWithSpinner<Produced>(
  request: SpinnerTaskRequest<Produced>,
): Promise<Produced> {
  const scanSpinner = request.prompts.spinner();
  scanSpinner.start(request.startMessage);

  try {
    const produced = await request.task();
    scanSpinner.stop(request.stopMessage);
    return produced;
  } catch (error) {
    scanSpinner.error('Operation failed.');
    throw error;
  }
}

export interface ApplyConfirmationRequest {
  readonly action: string;
  readonly apply: boolean | undefined;
  readonly json: boolean | undefined;
  readonly yes: boolean | undefined;
}

export async function askApplyConfirmation(
  request: ApplyConfirmationRequest,
): Promise<boolean | undefined> {
  if (request.apply != true) {
    return undefined;
  }

  if (request.yes == true) {
    return true;
  }

  if (request.json == true) {
    return false;
  }

  if (process.stdin.isTTY != true) {
    return false;
  }

  if (process.stdout.isTTY != true) {
    return false;
  }

  return askYes(`${request.action}. Continue?`);
}

export interface InteractiveCliRequest {
  readonly home?: string;
  readonly now?: Date;
  readonly olderThanMs?: number;
  readonly prompts?: PromptAdapter;
  readonly providers?: ReadonlyArray<ProviderAdapter>;
}
