// The interface the alerts module depends on (SPEC §4b). A rule the server
// refuses is an answer, not an exception: the adapter turns its field errors
// into the second half of `RuleAnswer`, so nothing above this line knows what
// a status code is (SPEC §6 Forms).

/** The fields a rule is made of, as a form names them. */
export type RuleField = 'metric' | 'above' | 'below';

/** A rule as it is asked for. */
export interface NewRule {
  /** Which dashboard metric the rule watches. */
  readonly metric: string;
  /** The value at or over which the alarm goes on. */
  readonly above: number;
  /** The value under which it goes off again. */
  readonly below: number;
}

/** A rule the server has kept. */
export interface AlertRule extends NewRule {
  readonly id: number;
}

/** What adding a rule answers: the kept rule, or a message per refused field. */
export type RuleAnswer =
  | { readonly rule: AlertRule }
  | { readonly errors: Partial<Readonly<Record<RuleField, string>>> };

/** Where alert rules are kept. */
export interface AlertsApi {
  /** Every rule kept so far. Takes an `AbortSignal` (SHR-L007). */
  list(signal: AbortSignal): Promise<readonly AlertRule[]>;
  /** Keeps a rule, or says per field why it will not. */
  add(rule: NewRule, signal: AbortSignal): Promise<RuleAnswer>;
}
