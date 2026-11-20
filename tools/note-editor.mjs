// Use the same editor engine as Markdown, with a smaller schema for quick notes.
import {Editor, Node, Extension} from '@tiptap/core';
import {Plugin} from '@tiptap/pm/state';
import {DOMParser as DocumentParser} from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';

const textOf = doc => doc.textBetween(0, doc.content.size, '\n', node => {
  if (node.type.name === 'hardBreak') return '\n';
  if (node.type.name === 'noteFile') return `附件：${node.attrs.path}`;
  return '';
});

const NoteFile = Node.create({
  name: 'noteFile',
  group: 'inline',
  inline: true,
  atom: true,
  leafText: node => `附件：${node.attrs.path}`,
  addAttributes() {
    return {path: {default:'', parseHTML: el => el.dataset.noteFile.slice(0, 4096), rendered:false}};
  },
  parseHTML() { return [{tag:'span[data-note-file]'}]; },
  renderHTML({node}) { return ['span', {'data-note-file':node.attrs.path}]; },
  addNodeView() {
    return ({node}) => {
      const dom = document.createElement('button');
      dom.type = 'button';
      dom.className = 'note-file';
      dom.contentEditable = 'false';
      dom.title = node.attrs.path;
      dom.textContent = node.attrs.path.split(/[\\/]/).at(-1);
      dom.setAttribute('aria-label', `在文件夹中显示 ${dom.textContent}`);
      dom.onclick = async () => {
        const result = await window.suira.notes.revealFile(node.attrs.path);
        if (!result.ok) dom.dispatchEvent(new CustomEvent('note-file-error', {bubbles:true, detail:result.error}));
      };
      return {dom, stopEvent: () => true};
    };
  }
});

window.SuiraNoteEditor = ({element, onChange, onSelection, onLimit}) => {
  let loading = false;
  const limit = Extension.create({
    addProseMirrorPlugins() {
      return [new Plugin({filterTransaction(transaction) {
        if (loading || !transaction.docChanged) return true;
        if (textOf(transaction.doc).length <= 20000 && transaction.doc.content.size <= 30000) return true;
        onLimit();
        return false;
      }})];
    }
  });
  const editor = new Editor({
    element,
    extensions: [StarterKit.configure({heading:{levels:[1,2]}, link:false, blockquote:false,
      code:false, codeBlock:false, horizontalRule:false, orderedList:false, trailingNode:false}), TaskList, TaskItem,
      NoteFile, Placeholder.configure({placeholder:'写下此刻想到的内容…'}), limit],
    parseOptions: {preserveWhitespace:'full'},
    editorProps: {attributes:{role:'textbox', 'aria-multiline':'true', 'aria-label':'速记正文', spellcheck:'false'}},
    onUpdate: onChange,
    onTransaction: onSelection
  });
  return {
    load(text, richText) {
      loading = true;
      try {
        let doc;
        if (richText) {
          const container = document.createElement('div');
          container.innerHTML = richText;
          doc = DocumentParser.fromSchema(editor.schema).parse(container, {preserveWhitespace:'full'});
        } else {
          doc = editor.schema.nodeFromJSON({type:'doc', content:text.split(/\r?\n/).map(line => ({type:'paragraph',
            ...(line ? {content:[{type:'text', text:line}]} : {})}))});
        }
        // Opening a saved note must not add a blank document to its undo history.
        const transaction = editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content);
        editor.view.dispatch(transaction.setMeta('addToHistory', false).setMeta('preventUpdate', true));
      } finally { loading = false; }
    },
    text: () => textOf(editor.state.doc),
    html: () => editor.getHTML(),
    active: (type, attrs) => editor.isActive(type, attrs),
    focusEnd: () => editor.commands.focus('end'),
    command(type) {
      const chain = editor.chain().focus();
      switch (type) {
        case 'large': return chain.setHeading({level:1}).run();
        case 'small': return chain.setHeading({level:2}).run();
        case 'body': return chain.setParagraph().run();
        case 'bold': return chain.toggleBold().run();
        case 'italic': return chain.toggleItalic().run();
        case 'underline': return chain.toggleUnderline().run();
        case 'strike': return chain.toggleStrike().run();
        case 'taskList': return chain.toggleTaskList().run();
        case 'bulletList': return chain.toggleBulletList().run();
      }
    },
    attach: path => editor.chain().focus().insertContent({type:'noteFile', attrs:{path}}).run(),
    ledger: text => editor.chain().focus().insertContent({type:'paragraph', content:[{type:'text',text}]}).run()
  };
};
