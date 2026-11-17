import {
  cancel,
  confirm,
  intro,
  isCancel,
  multiselect,
  note,
  outro,
  type SpinnerResult,
  select,
  spinner,
  text,
} from '@clack/prompts';

export type PromptOption<Choice extends string> = {
  readonly value: Choice;
  readonly label: string;
  readonly hint?: string;
  readonly disabled?: boolean;
};

export type PromptAdapter = {
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
  spinner: () => SpinnerResult;
};

export const clackPromptAdapter: PromptAdapter = {
  cancel,
  confirm: (question) => confirm(question),
  intro,
  isCancel,
  multiselect: (question) => {
    return multiselect({
      ...question,
      options: [...question.options] as never,
      initialValues: question.initialValues as never,
    });
  },
  note,
  outro,
  select: (question) =>
    select({
      ...question,
      options: [...question.options] as never,
    }),
  spinner,
  text: (question) => text(question),
};
