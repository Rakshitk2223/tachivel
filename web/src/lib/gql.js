// Suwayomi's GraphQL API, proxied at /suwayomi on the same origin (behind the same sign-in).
// Query shapes follow Suwayomi-Server v2.x (checked against a live server's schema).
const ENDPOINT = "/suwayomi/api/graphql";

export async function gql(query, variables = {}) {
  const res = await fetch(ENDPOINT, {
    method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) { location.reload(); throw new Error("Signed out."); }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(`The comics server isn't answering (${res.status}).`);
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return body.data;
}

// Upload a file (backup restore) using the GraphQL multipart request spec.
export async function gqlUpload(query, variables, fileVar, file) {
  const form = new FormData();
  form.append("operations", JSON.stringify({ query, variables: { ...variables, [fileVar]: null } }));
  form.append("map", JSON.stringify({ 0: [`variables.${fileVar}`] }));
  form.append("0", file);
  const res = await fetch(ENDPOINT, { method: "POST", credentials: "same-origin", body: form });
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return body.data;
}

// Thumbnails and pages come back as server paths like /api/v1/manga/12/thumbnail.
export const media = (u) => (!u ? null : /^https?:/.test(u) ? u : `/suwayomi${u}`);

export const MANGA_CARD = `id title thumbnailUrl inLibrary unreadCount downloadCount status
  source { id displayName } latestUploadedChapter { chapterNumber uploadDate } lastReadChapter { chapterNumber lastReadAt }`;
export const CHAPTER = `id name chapterNumber scanlator uploadDate isRead isBookmarked isDownloaded lastPageRead pageCount lastReadAt sourceOrder`;

export const Q = {
  categories: `{ categories(order: [{ by: ORDER }]) { nodes { id name order default mangas { totalCount } } } }`,
  library: `query($cat: Int!) { mangas(condition: { inLibrary: true, categoryIds: [$cat] }, order: [{ by: TITLE }]) { nodes { ${MANGA_CARD} } } }`,
  libraryAll: `{ mangas(condition: { inLibrary: true }, order: [{ by: TITLE }]) { nodes { ${MANGA_CARD} categories { nodes { id } } } } }`,
  manga: `query($id: Int!) { manga(id: $id) { ${MANGA_CARD} author artist description genre realUrl url
    categories { nodes { id name } } chapters { totalCount }
    trackRecords { nodes { id trackerId title lastChapterRead status } } } }`,
  chapter: `query($id: Int!) { chapter(id: $id) { ${CHAPTER} mangaId manga { id title realUrl source { displayName } } } }`,
  chapters: `query($id: Int!) { chapters(condition: { mangaId: $id }, order: [{ by: SOURCE_ORDER, byType: DESC }]) { nodes { ${CHAPTER} } } }`,
  updates: `query($first: Int) { chapters(filter: { inLibrary: { equalTo: true } }, order: [{ by: FETCHED_AT, byType: DESC }, { by: SOURCE_ORDER, byType: DESC }], first: $first) {
    nodes { ${CHAPTER} fetchedAt manga { id title thumbnailUrl source { displayName } } } } }`,
  history: `query($first: Int) { chapters(filter: { lastReadAt: { greaterThan: "0" } }, order: [{ by: LAST_READ_AT, byType: DESC }], first: $first) {
    nodes { ${CHAPTER} manga { id title thumbnailUrl } } } }`,
  downloads: `{ downloadStatus { state queue { position progress state tries chapter { id name chapterNumber pageCount } manga { id title thumbnailUrl } } } }`,
  sources: `{ sources { nodes { id name displayName lang iconUrl supportsLatest isConfigurable contentWarning } } }`,
  source: `query($id: LongString!) { source(id: $id) { id displayName lang supportsLatest homeUrl filters {
    __typename ... on HeaderFilter { name } ... on SeparatorFilter { name }
    ... on CheckBoxFilter { name cbDefault: default } ... on TriStateFilter { name tsDefault: default }
    ... on TextFilter { name txDefault: default } ... on SelectFilter { name selDefault: default values }
    ... on SortFilter { name values sortDefault: default { index ascending } }
    ... on GroupFilter { name filters { __typename ... on CheckBoxFilter { name cbDefault: default } ... on TriStateFilter { name tsDefault: default } } } } } }`,
  extensions: `{ extensions(order: [{ by: NAME }]) { nodes { pkgName name lang versionName iconUrl isInstalled hasUpdate isObsolete contentWarning } } }`,
  extensionStores: `{ extensionStores { nodes { indexUrl name } } }`,
  settings: `{ settings { autoDownloadNewChapters autoDownloadNewChaptersLimit autoDownloadIgnoreReUploads excludeCompleted excludeNotStarted excludeUnreadChapters
    excludeEntryWithUnreadChapters globalUpdateInterval updateMangas downloadAsCbz backupInterval backupTTL backupTime
    flareSolverrEnabled flareSolverrUrl flareSolverrTimeout flareSolverrSessionTtl flareSolverrAsResponseFallback maxSourcesInParallel } }`,
  about: `{ aboutServer { name version buildType } }`,
  trackers: `{ trackers { nodes { id name icon isLoggedIn authUrl } } }`,
  libraryUpdate: `{ libraryUpdateStatus { jobsInfo { isRunning totalJobs finishedJobs } } lastUpdateTimestamp { timestamp } }`,
};

export const M = {
  updateChapters: `mutation($ids: [Int!]!, $patch: UpdateChapterPatchInput!) { updateChapters(input: { ids: $ids, patch: $patch }) { chapters { id isRead isBookmarked lastPageRead } } }`,
  updateChapter: `mutation($id: Int!, $patch: UpdateChapterPatchInput!) { updateChapter(input: { id: $id, patch: $patch }) { chapter { id isRead lastPageRead } } }`,
  enqueue: `mutation($ids: [Int!]!) { enqueueChapterDownloads(input: { ids: $ids }) { downloadStatus { state } } }`,
  dequeue: `mutation($ids: [Int!]!) { dequeueChapterDownloads(input: { ids: $ids }) { downloadStatus { state } } }`,
  deleteDownloads: `mutation($ids: [Int!]!) { deleteDownloadedChapters(input: { ids: $ids }) { chapters { id isDownloaded } } }`,
  startDownloader: `mutation { startDownloader(input: {}) { downloadStatus { state } } }`,
  stopDownloader: `mutation { stopDownloader(input: {}) { downloadStatus { state } } }`,
  clearDownloader: `mutation { clearDownloader(input: {}) { downloadStatus { state } } }`,
  pages: `mutation($id: Int!) { fetchChapterPages(input: { chapterId: $id }) { pages chapter { id pageCount } } }`,
  refreshManga: `mutation($id: Int!) { fetchMangaAndChapters(input: { id: $id, fetchManga: true, fetchChapters: true }) { manga { id } } }`,
  setInLibrary: `mutation($id: Int!, $on: Boolean!) { updateManga(input: { id: $id, patch: { inLibrary: $on } }) { manga { id inLibrary } } }`,
  setInLibraryMany: `mutation($ids: [Int!]!, $on: Boolean!) { updateMangas(input: { ids: $ids, patch: { inLibrary: $on } }) { mangas { id inLibrary } } }`,
  mangaCategories: `mutation($id: Int!, $patch: UpdateMangaCategoriesPatchInput!) { updateMangaCategories(input: { id: $id, patch: $patch }) { manga { id } } }`,
  mangasCategories: `mutation($ids: [Int!]!, $patch: UpdateMangaCategoriesPatchInput!) { updateMangasCategories(input: { ids: $ids, patch: $patch }) { mangas { id } } }`,
  createCategory: `mutation($name: String!) { createCategory(input: { name: $name }) { category { id name } } }`,
  renameCategory: `mutation($id: Int!, $name: String!) { updateCategory(input: { id: $id, patch: { name: $name } }) { category { id name } } }`,
  deleteCategory: `mutation($id: Int!) { deleteCategory(input: { categoryId: $id }) { category { id } } }`,
  categoryOrder: `mutation($id: Int!, $position: Int!) { updateCategoryOrder(input: { id: $id, position: $position }) { categories { id order } } }`,
  updateLibrary: `mutation($cats: [Int!]) { updateLibrary(input: { categories: $cats }) { updateStatus { jobsInfo { isRunning } } } }`,
  fetchSource: `mutation($source: LongString!, $type: FetchSourceMangaType!, $page: Int!, $query: String, $filters: [FilterChangeInput!]) {
    fetchSourceManga(input: { source: $source, type: $type, page: $page, query: $query, filters: $filters }) { hasNextPage mangas { ${MANGA_CARD} } } }`,
  fetchExtensions: `mutation { fetchExtensions(input: {}) { extensions { pkgName } } }`,
  updateExtension: `mutation($id: String!, $patch: UpdateExtensionPatchInput!) { updateExtension(input: { id: $id, patch: $patch }) { extension { pkgName isInstalled hasUpdate } } }`,
  updateExtensions: `mutation($ids: [String!]!) { updateExtensions(input: { ids: $ids, patch: { update: true } }) { extensions { pkgName hasUpdate } } }`,
  addStore: `mutation($url: String!) { addExtensionStore(input: { indexUrl: $url }) { extensionStore { indexUrl } } }`,
  removeStore: `mutation($url: String!) { removeExtensionStore(input: { indexUrl: $url }) { extensionStore { indexUrl } } }`,
  setSettings: `mutation($s: PartialSettingsTypeInput!) { setSettings(input: { settings: $s }) { settings { autoDownloadNewChapters } } }`,
  createBackup: `mutation { createBackup(input: {}) { url } }`,
  restoreBackup: `mutation($backup: Upload!) { restoreBackup(input: { backup: $backup }) { id status { state } } }`,
};
