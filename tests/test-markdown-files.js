'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { SuiraStore } = require('../lib/store');
const { createWorkspace } = require('../lib/workspace');
const { markdownPaths, createMarkdownFiles } = require('../lib/markdown-files');
(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'suira-workspace-'));
  try {
    const file = path.join(root, '中文 file.md'); await fs.writeFile(file, '\uFEFF# Original');
    const store = new SuiraStore(path.join(root,'store.json')), workspace = createWorkspace(store), files = createMarkdownFiles(store,workspace);
    const args = markdownPaths(['--background',file,file,'https://example.com/a.md','--bad.md'], root);
    assert.deepEqual(args, [file]);
    const {item} = await files.open(file); assert.equal(item.text, '# Original');
    workspace.save('markdown', {id:item.id,title:item.title,text:'# Changed'}); await store.save();
    assert.equal((await files.open(file)).recovered, true);
    assert.equal(await fs.readFile(file,'utf8'), '\uFEFF# Original');
    await files.save(item.id); assert.equal(await fs.readFile(file,'utf8'), '# Changed');
    await Promise.all([files.save(item.id), files.save(item.id)]);
    assert.equal(workspace.list('markdown').length, 1);
    const reloaded = new SuiraStore(path.join(root,'store.json')); await reloaded.load();
    assert.equal(reloaded.getItem(item.id).meta.externalPath, await fs.realpath(file));
    await fs.writeFile(file, '# Other editor');
    await assert.rejects(files.save(item.id), /其他程序/); assert.equal(await fs.readFile(file,'utf8'), '# Other editor');
    await fs.writeFile(path.join(root,'large.md'),Buffer.alloc(800001)); await assert.rejects(files.open(path.join(root,'large.md')), /800/);
    await fs.writeFile(path.join(root,'binary.md'),'a\0b'); await assert.rejects(files.open(path.join(root,'binary.md')), /不受支持/);
    await fs.writeFile(path.join(root,'encoding.md'),Buffer.from([0xff,0xfe,0x41,0x00])); await assert.rejects(files.open(path.join(root,'encoding.md')), /UTF-8/);
    assert.equal((await files.open(file)).item.text, '# Other editor');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jxL0AAAAASUVORK5CYII=', 'base64');
    await fs.mkdir(path.join(root,'assets'));
    await fs.writeFile(path.join(root,'assets','中文 photo.png'),png);
    await fs.writeFile(path.join(root,'assets','wrong.png'),'not image data');
    await fs.writeFile(path.join(root,'elsewhere.png'),png);
    const images = await files.previewImages(item.id,['assets/中文%20photo.png','assets/wrong.png','assets/%2e%2e/elsewhere.png','https://example.com/a.png']);
    assert.deepEqual(images,[{url:'assets/中文%20photo.png',data:`data:image/png;base64,${png.toString('base64')}`}]);
    const draft = workspace.save('markdown',{title:'Draft',text:'![x](assets/中文%20photo.png)'});
    assert.deepEqual(await files.previewImages(draft.id,['assets/中文%20photo.png']),[]);
    const outside = await fs.mkdtemp(path.join(os.tmpdir(),'suira-outside-'));
    try {
      await fs.writeFile(path.join(outside,'outside.png'),png);
      await fs.symlink(outside,path.join(root,'outside'),process.platform==='win32'?'junction':'dir');
      assert.deepEqual(await files.previewImages(item.id,['outside/outside.png']),[]);
      await fs.unlink(path.join(root,'outside'));
    } finally {
      await fs.unlink(path.join(outside,'outside.png'));
      await fs.rmdir(outside);
    }
    console.log('PASS Markdown arguments, Unicode path/BOM, deduplication, draft recovery, explicit original-file save, restart metadata, external conflict protection and size/binary rejection');
  } finally { await fs.rm(root,{recursive:true,force:true}); }
})().catch(error=>{console.error(error);process.exitCode=1;});
