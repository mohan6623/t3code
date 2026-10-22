/**
 * Fork: names typed for new threads, by thread key, until the first turn starts. A launch can
 * create the thread and then fail, and a retry from the thread's own screen must keep the name.
 */
export const typedThreadNamesByThreadKey = new Map<string, string>();

/**
 * The typed name for a thread's next send. On the draft screen the field decides, so a cleared
 * field forgets the name. Without a draft (`draftName` null) the name the draft sent stays.
 */
export function resolveTypedThreadName(threadKey: string, draftName: string | null) {
  if (draftName === "") typedThreadNamesByThreadKey.delete(threadKey);
  else if (draftName !== null) typedThreadNamesByThreadKey.set(threadKey, draftName);
  return typedThreadNamesByThreadKey.get(threadKey);
}

/** The name field of a new thread's draft, as the send paths read and reset it. */
export interface DraftThreadName {
  /** The trimmed name; empty when none was typed. */
  readonly value: string;
  /** The field's text as typed. */
  readonly input: string;
  /** Removes the name rather than emptying it, so a restore can tell this from a user clear. */
  readonly clear: () => void;
  /** Puts a sent name back, unless the field was typed in or cleared since. */
  readonly restore: (input: string) => void;
}
