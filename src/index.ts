import { createApp } from "./app";
import { loadRuntimeDataset } from "./data/load-runtime-dataset";
import runtimeDataset from "./data/runtime-dataset.json";

const app = createApp(loadRuntimeDataset(runtimeDataset));

export default app;
