export async function migrateReaderStorage(gm) {
  const oldPrefix = "kakomonn-reader.";
  const newPrefix = "exam-practice-reader.";
  for (const key of await gm.listValues()) {
    if (!key.startsWith(oldPrefix)) continue;
    const target = newPrefix + key.slice(oldPrefix.length);
    const value = await gm.getValue(key);
    const existing = await gm.getValue(target);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(value)) {
      throw new Error("Conflicting Reader storage during product rename: " + target);
    }
    if (existing === undefined) await gm.setValue(target, value);
    await gm.deleteValue(key);
  }
}
