import { prepareTemplateDatabase } from "@sim/db/testing";

export default async function setup(): Promise<void> {
  await prepareTemplateDatabase();
}
