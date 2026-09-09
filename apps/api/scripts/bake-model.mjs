// Downloads the embedding model into the image at build time so the grouping
// function never needs outbound network access at runtime. That is what keeps
// it running in a private subnet without a NAT gateway.
const { env, pipeline } = await import("@huggingface/transformers");

env.cacheDir = process.env.MODEL_CACHE_DIR ?? "/opt/models";

await pipeline(
  "feature-extraction",
  "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  { dtype: "q8" }
);

console.log(`Model baked into ${env.cacheDir}`);
