import "server-only";

/** Provider failure with a message that is safe (and useful) to show the user. */
export class ProviderError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "ProviderError";
  }
}
