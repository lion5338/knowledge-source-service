import { createSourceCollectionSeeder } from "../../src/lib/source-collections/source-collection-seed.js";

const seeder = createSourceCollectionSeeder();
const result = await seeder.seedSourceCollections({ actor: "script" });

console.log(JSON.stringify(result, null, 2));
