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

export class RoadGraphUnavailableError extends Error {
  constructor() {
    super("The static road graph is unavailable.");
    this.name = "RoadGraphUnavailableError";
  }
}

// Điểm tọa độ rõ ràng ngoài vùng phủ road graph (bbox mở rộng snap max) → handler map 422.
export class OutsideRoadGraphCoverageError extends Error {
  constructor() {
    super("The requested point is outside the road graph coverage area.");
    this.name = "OutsideRoadGraphCoverageError";
  }
}
