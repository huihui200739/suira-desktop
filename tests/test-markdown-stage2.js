'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SuiraStore } = require('../lib/store');
const { createWorkspace } = require('../lib/workspace');
const { createMarkdownFiles } = require('../lib/markdown-files');
const { registerWorkspaceFileIpc } = require('../lib/workspace-file-ipc');
const { panguMarkdown, compactCapture } = require('../src/text-spacing');
const { splitSlides, readingMinutes } = require('../src/markdown-slides');

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

(async () => {
  // 1. Pangu CJK-Latin auto-spacing: protects frontmatter, fenced code, inline code, HTML, URLs
  const sample = [
    '---',
    'title: 中文2026测试',
    '---',
    '',
    '# 使用Suira写作2026',
    '',
    '正文支持Markdown语法100%离线，行内`code中文123`不改动。',
    '查看[我的文档2026与`内联Code中文123`](assets/中文photo(2026)版.png)与https://example.com/中文2026链接。',
    '引用[说明2026][中ABC]、折叠[中ABC][]和简写[中ABC]。',
    '跨行折叠[页中ABC',
    '续DEF][]和跨行简写[页中ABC',
    '续DEF]。',
    '[页中ABC',
    '续DEF]: https://example.com/multi',
    '[中ABC]:',
    'assets/中ABC.png',
    '"中文2026标题"',
    '[ref]: assets/中ABC.png',
    '<span style="color:#b93836">高亮Test内容</span><!-- 注释Test -->',
    '<!--',
    '多行注释中文ABC不加空格',
    '-->',
    '> ```js',
    '> const quoted = "引用内代码中文789";',
    '> ```',
    '',
    '```js',
    'const msg = "代码内中文123不加空格";',
    '```',
    '',
    '~~~txt',
    '波浪线围栏中文456也不加空格',
    '~~~'
  ].join('\n');
  const formatted = panguMarkdown(sample);
  assert.ok(formatted.startsWith('---\ntitle: 中文2026测试\n---\n'), 'YAML frontmatter untouched');
  assert.ok(formatted.includes('# 使用 Suira 写作 2026'), 'Heading CJK-Latin spaced');
  assert.ok(formatted.includes('正文支持 Markdown 语法 100% 离线，行内`code中文123`不改动。'), 'Inline code untouched, percent spaced');
  assert.ok(formatted.includes('[我的文档 2026 与`内联Code中文123`](assets/中文photo(2026)版.png)'), 'Balanced-paren URL & inline code inside link label preserved');
  assert.ok(formatted.includes('引用[说明 2026][中ABC]、折叠[中ABC][]和简写[中ABC]。'), 'Full, collapsed, and shortcut reference link keys preserved');
  assert.ok(formatted.includes('跨行折叠[页中ABC\n续DEF][]和跨行简写[页中ABC\n续DEF]。'), 'Multi-line collapsed & shortcut reference link keys preserved verbatim');
  assert.ok(formatted.includes('[页中ABC\n续DEF]: https://example.com/multi'), 'Multi-line reference link definition header preserved');
  assert.ok(formatted.includes('\n[中ABC]:\nassets/中ABC.png\n"中文2026标题"\n'), 'Multi-line reference link definition & title preserved');
  assert.ok(formatted.includes('\n[ref]: assets/中ABC.png\n'), 'Link reference definition preserved');
  assert.ok(formatted.includes('https://example.com/中文2026'), 'Bare URL verbatim');
  assert.ok(formatted.includes('<span style="color:#b93836">高亮 Test 内容</span><!-- 注释Test -->'), 'HTML attrs & comments verbatim');
  assert.ok(formatted.includes('<!--\n多行注释中文ABC不加空格\n-->'), 'Multi-line HTML comment untouched');
  assert.ok(formatted.includes('> const quoted = "引用内代码中文789";'), 'Blockquoted code fence untouched');
  assert.ok(formatted.includes('const msg = "代码内中文123不加空格";'), 'Backtick fence untouched');
  assert.ok(formatted.includes('波浪线围栏中文456也不加空格'), 'Tilde fence untouched');
  assert.equal(panguMarkdown(formatted), formatted, 'panguMarkdown is strictly idempotent');
  assert.equal(compactCapture('已 核 对'), '已核对', 'compactCapture preserved');

  // 2. Slide splitter (`---` PPT mode) + Setext H2, GFM table, leading `---`, & fence protection
  const deck = [
    '---',
    'title: 随序发布会',
    '---',
    '',
    '# 第一页标题',
    '',
    '内容包含代码块里的分割线：',
    '```md',
    '---',
    '```',
    '',
    '---',
    '',
    '## 第二页：架构',
    '',
    '小节副标题',
    '----',
    '',
    '| 列一 | 列二 |',
    '| --- | --- |',
    '| A | B |',
    '---',
    '## 第三页：表格后直接分页',
    '',
    '***',
    '',
    '第四页无标题纯正文'
  ].join('\n');
  const parsed = splitSlides(deck);
  assert.equal(parsed.slides.length, 4, 'Splits into 4 slides (table followed immediately by --- splits; Setext H2 does not)');
  assert.equal(parsed.slides[0].title, '第一页标题');
  assert.equal(parsed.slides[1].title, '第二页：架构');
  assert.ok(parsed.slides[1].markdown.includes('小节副标题\n----'), 'Setext H2 stays intact on slide 2');
  assert.equal(parsed.slides[2].title, '第三页：表格后直接分页');
  assert.equal(parsed.slides[3].title, '第四页无标题纯正文');
  // Leading `---` before a real slide must NOT be swallowed as YAML frontmatter
  const leadingBreak = splitSlides('---\n\n# 首页标题\n\n---\n\n# 第二页');
  assert.equal(leadingBreak.slides.length, 2, 'Leading --- does not swallow slide 1 as frontmatter');
  assert.equal(leadingBreak.slides[0].title, '首页标题');
  // Colon without following whitespace is NOT YAML frontmatter!
  const colonSingle = splitSlides('---\nUsage:read this first\n---');
  assert.equal(colonSingle.frontmatter, '', 'Usage:read this first is not swallowed as YAML frontmatter');
  assert.ok(colonSingle.slides[0].markdown.includes('Usage:read this first'), 'Paragraph text preserved when not YAML');
  const colonTwoSlides = splitSlides('---\nUsage:read this first\n\n---\n\n# Slide 2');
  assert.equal(colonTwoSlides.frontmatter, '');
  assert.equal(colonTwoSlides.slides.length, 2, 'Non-YAML block followed by blank line + --- splits into 2 slides');
  assert.ok(colonTwoSlides.slides[0].markdown.includes('Usage:read this first'));
  // Pipe-less GFM table row followed directly by `---` splits slides (multi-col AND 1-col)!
  const pipelessRow = splitSlides('A | B\n--- | ---\nA\n---\n# 下一页');
  assert.equal(pipelessRow.slides.length, 2, 'Pipe-less GFM table row followed by --- splits slides');
  assert.equal(pipelessRow.slides[1].title, '下一页');
  const singleColTable = splitSlides('| Col |\n| --- |\nA\n---\n# 单列表格下页');
  assert.equal(singleColTable.slides.length, 2, 'Single-column GFM table + pipe-less row splits slides');
  assert.equal(singleColTable.slides[1].title, '单列表格下页');
  const alignedSingleCol = splitSlides('Col\n:---:\nA\n---\n# 对齐单列表格下页');
  assert.equal(alignedSingleCol.slides.length, 2, 'Pipe-less aligned single-column GFM table splits slides');
  assert.equal(alignedSingleCol.slides[1].title, '对齐单列表格下页');
  // Mismatched header/delimiter column count is NOT a GFM table -> Setext H2 stays intact!
  const mismatchedTable = splitSlides('A | B\n--- | --- | ---\n真正副标题\n---');
  assert.equal(mismatchedTable.slides.length, 1, 'Mismatched header/delim columns do not turn Setext H2 into slide break');
  assert.ok(mismatchedTable.slides[0].markdown.includes('真正副标题\n---'));
  assert.equal(splitSlides('').slides.length, 1);
  assert.equal(readingMinutes(''), 0);
  assert.equal(readingMinutes('短句'), 1);
  assert.equal(readingMinutes('中'.repeat(900)), 3);

  // 3. Local-First folder workspace, createInFolder, unmountFolder, and assets/ image save
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'suira-md-stage2-'));
  const notesDir = path.join(root, 'notes');
  const subDir = path.join(notesDir, 'sub');
  const gitDir = path.join(notesDir, '.git');
  const outsideDir = path.join(root, 'outside');
  try {
    await fs.mkdir(subDir, { recursive: true });
    await fs.mkdir(gitDir, { recursive: true });
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.writeFile(path.join(notesDir, 'welcome.md'), '# 欢迎\n\n本地文件夹第一篇');
    await fs.writeFile(path.join(subDir, 'nested.markdown'), '# 嵌套文档');
    await fs.writeFile(path.join(gitDir, 'ignored.md'), '# 不应扫描');
    await fs.writeFile(path.join(notesDir, 'bad.md'), 'bin\0data');
    await fs.writeFile(path.join(outsideDir, 'secret.md'), '# 外部文件');

    const store = new SuiraStore(path.join(root, 'store.json'));
    const workspace = createWorkspace(store);
    const files = createMarkdownFiles(store, workspace);

    // Pre-open welcome.md and leave an unsaved Suira draft — openFolder must NOT clobber it!
    const pre = await files.open(path.join(notesDir, 'welcome.md'));
    workspace.save('markdown', { id: pre.item.id, title: pre.item.title, text: '# 欢迎\n\n未写回的本地草稿' });
    await store.save();

    const scan = await files.openFolder(notesDir);
    assert.equal(scan.opened, 2, 'Opens welcome.md and sub/nested.markdown (skips .git and bad.md)');
    assert.equal(scan.skipped, 1, 'Counts bad.md as skipped');
    assert.equal(store.getItem(pre.item.id).text, '# 欢迎\n\n未写回的本地草稿', 'openFolder never overwrites unsaved draft');
    assert.equal(files.mountedFolders().length, 1);

    // Mounted folders persist across store restart
    const reloaded = new SuiraStore(path.join(root, 'store.json'));
    await reloaded.load();
    assert.equal(reloaded.data.settings.markdownFolders.length, 1);

    // createInFolder writes real .md file, deduplicates, sanitizes reserved names, rejects unmounted dir
    const created1 = await files.createInFolder(notesDir, '周报/总结');
    const created2 = await files.createInFolder(notesDir, '周报/总结');
    const createdReserved = await files.createInFolder(notesDir, 'CON');
    assert.equal(path.basename(created1.filePath), '周报 总结.md');
    assert.equal(path.basename(created2.filePath), '周报 总结 2.md');
    assert.equal(path.basename(createdReserved.filePath), '未命名文档.md');
    assert.equal(await fs.readFile(created1.filePath, 'utf8'), '# 周报/总结\n\n');
    await assert.rejects(() => files.createInFolder(outsideDir, 'hack'), /已打开的本地文件夹/);

    // saveAssetImage writes to relative assets/ and previewImages reads it right back
    const savedImg = await files.saveAssetImage(created1.item.id, TINY_PNG, 'png');
    assert.match(savedImg.relativePath, /^assets\/img-\d{8}-\d{6}-[0-9a-f]{4}\.png$/);
    assert.equal((await fs.readFile(savedImg.fullPath)).equals(TINY_PNG), true);
    const previewed = await files.previewImages(created1.item.id, [savedImg.relativePath]);
    assert.equal(previewed.length, 1);
    assert.equal(previewed[0].data, `data:image/png;base64,${TINY_PNG.toString('base64')}`);

    // Rejects mismatched binary magic bytes, 12-byte header-only GIF/WebP, & symlinked assets/ escape
    await assert.rejects(() => files.saveAssetImage(created1.item.id, Buffer.from('not-a-png-at-all'), 'png'), /不匹配/);
    const fake12Gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([1, 0, 1, 0, 0, 0])]);
    const fake12Webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
    // Corrupt LZW GIF, missing-EOI GIF, & header-only WebP (VP8 10B / VP8L 5B)!
    const validGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
    const missingEoiGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    const corruptLzwGif = Buffer.from(validGif);
    corruptLzwGif[corruptLzwGif.length - 4] = 0xff;
    corruptLzwGif[corruptLzwGif.length - 3] = 0xff;
    const headerOnlyVp8Webp = Buffer.from('524946461600000057454250565038200a0000003001009d012a01000100', 'hex');
    const headerOnlyVp8lWebp = Buffer.from('5249464612000000574542505650384c050000002f0000000000', 'hex');
    await assert.rejects(() => files.saveAssetImage(created1.item.id, fake12Gif, 'gif'), /不完整/);
    await assert.rejects(() => files.saveAssetImage(created1.item.id, missingEoiGif, 'gif'), /不完整|损坏/);
    await assert.rejects(() => files.saveAssetImage(created1.item.id, corruptLzwGif, 'gif'), /损坏|不完整/);
    await assert.rejects(() => files.saveAssetImage(created1.item.id, fake12Webp, 'webp'), /文件头|过短|无效/);
    await assert.rejects(() => files.saveAssetImage(created1.item.id, headerOnlyVp8Webp, 'webp'), /缺少图像数据|分区/);
    await assert.rejects(() => files.saveAssetImage(created1.item.id, headerOnlyVp8lWebp, 'webp'), /缺少图像数据|无效/);
    // Valid spec-compliant 1x1 GIF (with LZW EOI) & 1x1 lossless WebP accepted!
    const validWebp = Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=', 'base64');
    const savedGif = await files.saveAssetImage(created1.item.id, validGif, 'gif');
    const savedWebp = await files.saveAssetImage(created1.item.id, validWebp, 'webp');
    assert.match(savedGif.relativePath, /^assets\/img-.*\.gif$/);
    assert.match(savedWebp.relativePath, /^assets\/img-.*\.webp$/);
    const symDocPath = path.join(subDir, 'nested.markdown');
    const symDoc = workspace.list('markdown').find((d) => d.meta?.externalPath?.toLowerCase() === symDocPath.toLowerCase());
    await fs.symlink(outsideDir, path.join(subDir, 'assets'), process.platform === 'win32' ? 'junction' : 'dir');
    try {
      await assert.rejects(() => files.saveAssetImage(symDoc.id, TINY_PNG, 'png'), /有效的本地文件夹|越界/);
    } finally {
      await fs.unlink(path.join(subDir, 'assets'));
    }

    // Mounted folder replaced by junction pointing to outsideDir -> refresh MUST reject & never mount outsideDir!
    const replaceDir = path.join(root, 'replaceable');
    await fs.mkdir(replaceDir, { recursive: true });
    await fs.writeFile(path.join(replaceDir, 'ok.md'), '# ok');
    const mountedRep = await files.openFolder(replaceDir);
    await fs.rm(replaceDir, { recursive: true, force: true });
    await fs.symlink(outsideDir, replaceDir, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      await assert.rejects(
        () => files.openFolder(mountedRep.folder, { expectedRealPath: mountedRep.folder }),
        /符号链接|实际位置/
      );
      assert.equal(files.mountedFolders().some((d) => d.toLowerCase() === outsideDir.toLowerCase()), false, 'Junction target never mounted');
    } finally {
      await fs.unlink(replaceDir);
      await files.unmountFolder(mountedRep.folder);
    }

    // 4. IPC integration: workspace:open-folder, workspace:paste-image (assets/ & suira-image://), unmount
    const handlers = new Map();
    const activeDocuments = new Map([[1, { id: created1.item.id }]]);
    const fakeEvent = { sender: { id: 1 } };
    let storedInternalImages = 0;
    registerWorkspaceFileIpc({
      handle: (ch, fn) => handlers.set(ch, fn),
      store,
      workspace,
      markdownFiles: files,
      removalUndo: { remove: async () => ({ ok: true }) },
      broadcast: () => {},
      senderWindow: () => null,
      dialog: {
        showOpenDialog: async () => ({ canceled: false, filePaths: [notesDir] }),
        showSaveDialog: async () => ({ canceled: true })
      },
      clipboard: {
        readImage: () => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), toPNG: () => TINY_PNG })
      },
      nativeImage: {
        createFromBuffer: (buf) => ({
          isEmpty: () => !buf.equals(TINY_PNG),
          getSize: () => ({ width: 1, height: 1 }),
          toPNG: () => buf
        })
      },
      addImageToStore: async () => ({ id: `img-${++storedInternalImages}` }),
      addImageBufferToStore: async (_buf, ext) => ({ id: `img-buf-${ext}-${++storedInternalImages}` }),
      activeDocuments,
      createExportWindow: () => null,
      exportPage: ''
    });

    assert.equal((await handlers.get('workspace:open-folder')(fakeEvent, { refresh: true, folder: outsideDir })).ok, false, 'Rejects refresh of unmounted folder');
    const pasteLocal = await handlers.get('workspace:paste-image')(fakeEvent, {
      id: created1.item.id,
      dataUrl: `data:image/png;base64,${TINY_PNG.toString('base64')}`,
      alt: '架构图'
    });
    assert.equal(pasteLocal.ok, true);
    assert.equal(pasteLocal.savedTo, 'assets');
    assert.match(pasteLocal.markdown, /^!\[架构图\]\(assets\/img-.*\.png\)$/);

    // Discarding a newly created asset cleans up the file; discarding an untracked file is refused!
    const createdAssetFull = path.join(notesDir, pasteLocal.relativePath);
    assert.equal(await fs.stat(createdAssetFull).then(() => true, () => false), true);
    const discarded = await handlers.get('workspace:paste-image')(fakeEvent, {
      id: created1.item.id,
      discardRelativePath: pasteLocal.relativePath
    });
    assert.equal(discarded.ok, true);
    assert.equal(discarded.discarded, true);
    assert.equal(await fs.stat(createdAssetFull).then(() => true, () => false), false, 'Discarded orphan asset deleted from assets/');
    await fs.writeFile(path.join(notesDir, 'assets', 'existing.png'), TINY_PNG);
    const badDiscard = await handlers.get('workspace:paste-image')(fakeEvent, {
      id: created1.item.id,
      discardRelativePath: 'assets/existing.png'
    });
    assert.equal(badDiscard.discarded, false, 'Untracked pre-existing asset is never deleted');
    assert.equal(await fs.stat(path.join(notesDir, 'assets', 'existing.png')).then(() => true, () => false), true);

    // Concurrent refresh + typing: saving draft with older baseExternalHash preserves older hash -> saveFile detects conflict!
    const origExternal = await files.open(path.join(notesDir, 'welcome.md'));
    await files.save(origExternal.item.id);
    const oldHash = store.getItem(origExternal.item.id).meta.externalHash;
    await fs.writeFile(path.join(notesDir, 'welcome.md'), '# 外部已修改磁盘内容\n');
    await files.openFolder(notesDir); // refreshes store externalHash to new disk hash
    assert.notEqual(store.getItem(origExternal.item.id).meta.externalHash, oldHash);
    // Renderer sends draft with its loaded baseExternalHash (oldHash):
    workspace.save('markdown', { id: origExternal.item.id, title: 'welcome', text: '# 旧正文 + TYPING', baseExternalHash: oldHash });
    assert.equal(store.getItem(origExternal.item.id).meta.externalHash, oldHash, 'Draft save preserves older baseExternalHash');
    await assert.rejects(() => files.save(origExternal.item.id), /已被其他程序修改/, 'Ctrl+S refuses to overwrite external change');

    // Bad PNG rejected cleanly
    const badPaste = await handlers.get('workspace:paste-image')(fakeEvent, {
      id: created1.item.id,
      dataUrl: 'data:image/png;base64,aGVsbG8='
    });
    assert.equal(badPaste.ok, false);

    // Internal Suira doc falls back to suira-image:// (including GIF & WebP via addImageBufferToStore!)
    const internalDoc = workspace.save('markdown', { title: '内部笔记', text: '# Hi' });
    activeDocuments.set(1, { id: internalDoc.id });
    const pasteInternal = await handlers.get('workspace:paste-image')(fakeEvent, { id: internalDoc.id });
    assert.equal(pasteInternal.ok, true);
    assert.equal(pasteInternal.savedTo, 'suira');
    assert.equal(pasteInternal.markdown, '![图片](suira-image://img-1)');
    const pasteInternalGif = await handlers.get('workspace:paste-image')(fakeEvent, {
      id: internalDoc.id,
      dataUrl: `data:image/gif;base64,${validGif.toString('base64')}`,
      alt: '动图'
    });
    assert.equal(pasteInternalGif.ok, true);
    assert.equal(pasteInternalGif.savedTo, 'suira');
    assert.match(pasteInternalGif.markdown, /^!\[动图\]\(suira-image:\/\/img-buf-gif-\d+\)$/);
    const pasteInternalWebp = await handlers.get('workspace:paste-image')(fakeEvent, {
      id: internalDoc.id,
      dataUrl: `data:image/webp;base64,${validWebp.toString('base64')}`,
      alt: '无损图'
    });
    assert.equal(pasteInternalWebp.ok, true);
    assert.equal(pasteInternalWebp.savedTo, 'suira');
    assert.match(pasteInternalWebp.markdown, /^!\[无损图\]\(suira-image:\/\/img-buf-webp-\d+\)$/);

    // Active-document mismatch guard
    const stalePaste = await handlers.get('workspace:paste-image')(fakeEvent, { id: created1.item.id });
    assert.equal(stalePaste.ok, false);

    // Unmount leaves files untouched on disk
    await files.unmountFolder(notesDir);
    assert.equal(files.mountedFolders().length, 0);
    assert.equal(await fs.readFile(created1.filePath, 'utf8'), '# 周报/总结\n\n');

    console.log('PASS Stage 2 Markdown Pangu spacing, slide splitter, Local-First folders, and assets/ image paste');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
