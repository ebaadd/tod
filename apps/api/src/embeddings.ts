import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Grouping compares vectors, so a vector produced by one model can never be
// compared with one from another. Every provider reports a modelVersion, and
// semantic_groups records it; changing provider starts fresh groups rather
// than silently mixing incompatible embeddings.
export type EmbeddingProvider = {
  readonly modelVersion: string;
  embed(text: string): Promise<number[]>;
};

const LOCAL_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const BEDROCK_MODEL = "amazon.titan-embed-text-v2:0";

// Runs the quantized ONNX model in-process. No network calls, so this works
// inside a VPC with no NAT gateway, which is why it is the deployed default.
// Costs a slow first call while the model loads into memory.
function localProvider(): EmbeddingProvider {
  const cacheDir = resolve(process.env.MODEL_CACHE_DIR ?? ".cache/models");
  let extractor: any;

  return {
    modelVersion: `${LOCAL_MODEL}:mean:q8:v1`,
    async embed(text) {
      if (!extractor) {
        const { env: transformersEnv, pipeline } =
          await import("@huggingface/transformers");

        // Lambda's filesystem is read-only outside /tmp. When the model is
        // baked into the image the directory already exists and this is a
        // no-op; failing to create it is not fatal.
        try {
          mkdirSync(cacheDir, { recursive: true });
        } catch {}
        transformersEnv.cacheDir = cacheDir;

        console.log(
          "Loading multilingual embedding model. " +
          "First use downloads model files; later runs use the local cache."
        );
        extractor = await (pipeline as any)("feature-extraction", LOCAL_MODEL, {
          dtype: "q8"
        });
        console.log("Embedding model ready.");
      }

      const result = await extractor(text, { pooling: "mean", normalize: true });
      return Array.from(result.data as ArrayLike<number>);
    }
  };
}

// Calls Bedrock instead of loading a model. Starts instantly and keeps the
// container small, but needs outbound access: a Lambda in a private subnet
// requires a Bedrock interface endpoint or a NAT gateway, both of which bill
// hourly whether or not anyone uses the app.
function bedrockProvider(): EmbeddingProvider {
  let runtime: any;

  return {
    modelVersion: `${BEDROCK_MODEL}:d512:v1`,
    async embed(text) {
      if (!runtime) {
        const { BedrockRuntimeClient } =
          await import("@aws-sdk/client-bedrock-runtime");
        runtime = new BedrockRuntimeClient({
          region: process.env.BEDROCK_REGION ?? process.env.AWS_REGION
        });
      }

      const { InvokeModelCommand } =
        await import("@aws-sdk/client-bedrock-runtime");

      const response = await runtime.send(new InvokeModelCommand({
        modelId: BEDROCK_MODEL,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          inputText: text,
          dimensions: 512,
          normalize: true
        })
      }));

      const body = JSON.parse(new TextDecoder().decode(response.body));
      if (!Array.isArray(body.embedding)) {
        throw new Error("Bedrock returned no embedding.");
      }
      return body.embedding as number[];
    }
  };
}

let provider: EmbeddingProvider | undefined;

export function embeddings(): EmbeddingProvider {
  if (!provider) {
    const choice = process.env.EMBEDDING_PROVIDER ?? "local";
    if (choice !== "local" && choice !== "bedrock") {
      throw new Error("EMBEDDING_PROVIDER must be 'local' or 'bedrock'.");
    }
    provider = choice === "bedrock" ? bedrockProvider() : localProvider();
  }
  return provider;
}
