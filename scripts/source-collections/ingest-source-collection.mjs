import { createSourceCollectionIngestor } from "../../src/lib/source-collections/source-snapshot-ingest.js";

const collectionId = process.argv.slice(2).find((arg) => !arg.startsWith("-"));

if (!collectionId) {
  console.error("Usage: npm run source-collections:ingest -- <collection_id>");
  process.exit(1);
}

const ingestor = createSourceCollectionIngestor();
const result = await ingestor.ingestSourceCollectionSnapshot({ collectionId, actor: "script" });

console.log(JSON.stringify(result, null, 2));
