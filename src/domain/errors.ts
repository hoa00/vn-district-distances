export class DatasetUnavailableError extends Error {
  constructor() {
    super("The bundled commune dataset is unavailable.");
    this.name = "DatasetUnavailableError";
  }
}

export class CommuneNotFoundError extends Error {
  readonly communeIds: readonly string[];

  constructor(communeIds: readonly string[]) {
    super("One or more commune identifiers were not found.");
    this.name = "CommuneNotFoundError";
    this.communeIds = Object.freeze([...communeIds]);
  }
}
