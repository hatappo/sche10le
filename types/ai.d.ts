interface Sche10leLanguageModel {
  prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}
interface Sche10leModelOptions {
  expectedInputs: { type: "text"; languages: string[] }[];
  expectedOutputs: { type: "text"; languages: string[] }[];
}
interface Sche10leLanguageModelAPI {
  availability(
    options: Sche10leModelOptions,
  ): Promise<"unavailable" | "downloadable" | "downloading" | "available">;
  create(
    options: Sche10leModelOptions & { signal?: AbortSignal },
  ): Promise<Sche10leLanguageModel>;
}
interface Window {
  LanguageModel?: Sche10leLanguageModelAPI;
}
