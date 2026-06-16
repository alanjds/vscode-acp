import MiniSearch from 'minisearch';

export type IndexedFile = {
  id: string;
  path: string;
  name: string;
  content: string;
};

export type FileSearchEntry = {
  path: string;
  name: string;
};

const SEARCH_OPTIONS = {
  boost: { name: 3, path: 2, content: 1 },
  prefix: true,
  fuzzy: 0.2,
} as const;

export function createFileSearchIndex(files: IndexedFile[]): MiniSearch<IndexedFile> {
  const miniSearch = new MiniSearch<IndexedFile>({
    fields: ['name', 'path', 'content'],
    storeFields: ['name', 'path'],
    searchOptions: SEARCH_OPTIONS,
  });

  miniSearch.addAll(files);
  return miniSearch;
}

export function searchIndexedFiles(
  index: MiniSearch<IndexedFile>,
  files: IndexedFile[],
  query: string,
  limit: number,
): FileSearchEntry[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return files.slice(0, limit).map(toSearchEntry);
  }

  return index
    .search(normalizedQuery)
    .slice(0, limit)
    .map(result => ({
      path: String(result.path),
      name: String(result.name),
    }));
}

function toSearchEntry(file: IndexedFile): FileSearchEntry {
  return {
    path: file.path,
    name: file.name,
  };
}
