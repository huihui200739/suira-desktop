const paths = {
  library: 'M4 5h16v15H4z M4 9h16 M9 13h6',
  files: 'M15.45 4.2H6.54a2.88 2.88 0 0 0-2.88 2.88v9.84a2.88 2.88 0 0 0 2.88 2.88h10.92a2.88 2.88 0 0 0 2.88-2.88v-8.4z M15.45 4.2v2.4a1.92 1.92 0 0 0 1.92 1.92h2.97 M8.16 13.08h7.68 M8.16 16.2h5.04',
  recent: 'M3 12a9 9 0 1 1 3 7 M3 12V6 M3 12h6 M12 7v5l4 2',
  folder: 'M3 7h6l2 2h10v11H3z M3 7V4h6l2 3h8v2',
  new: 'M11 5H4v15h15v-7 M10 14l1-4 8-8 3 3-8 8z',
  sidebar: 'M3 4h18v16H3z M9 4v16',
  outline: 'M8 6h12 M8 12h12 M8 18h12 M4 6h1 M4 12h1 M4 18h1',
  source: 'm8 7-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16',
  split: 'M3 4h18v16H3z M12 4v16',
  preview: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  focus: 'M3 3h6 M3 3v6 M21 3h-6 M21 3v6 M3 21h6 M3 21v-6 M21 21h-6 M21 21v-6',
  more: 'M4 12h1 M11 12h1 M18 12h1',
  format: 'M3 19 9 5l6 14 M5 15h8 M16 12h5 M18.5 12v7'
};

export function layoutIcon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
}

export function iconButton(button, icon, label) {
  button.type = 'button';
  button.classList.add('mia-icon');
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = layoutIcon(icon);
  return button;
}

// Shared by the Windows editor and hosts with their own document store.
export function mountEditorLayout({ shell, sidebar, search, create, list, main, heading, actions, brand, open }) {
  const doc = shell.ownerDocument;
  const element = (tag, className) => Object.assign(doc.createElement(tag), { className });
  const library = element('nav', 'mia-library');
  library.setAttribute('aria-label', '文档位置');
  const libraryHead = element('div', 'mia-library-head');
  const wordmark = element('strong', 'mia-brand');
  wordmark.textContent = brand;
  libraryHead.append(wordmark, iconButton(open, 'folder', '打开 Markdown 文件'));
  const sections = element('div', 'mia-sections');
  library.append(libraryHead, sections);
  const listHead = element('div', 'mia-list-head');
  search.setAttribute('aria-label', '搜索文档');
  listHead.append(search, iconButton(create, 'new', '新建文档'));
  shell.classList.add('mia-shell');
  sidebar.classList.add('mia-notes');
  list.classList.add('mia-list');
  main.classList.add('mia-main');
  heading.classList.add('mia-heading');
  actions.classList.add('mia-actions');
  heading.append(actions);
  sidebar.prepend(listHead);
  shell.prepend(library);
  return { library, sections, listHead };
}

export function renderLocations(container, locations, selected, onSelect) {
  const buttons = locations.map(({ id, label, title = label, icon = 'folder' }) => {
    const button = container.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'mia-location';
    button.title = title;
    button.setAttribute('aria-current', selected === id ? 'true' : 'false');
    button.innerHTML = layoutIcon(icon);
    const text = container.ownerDocument.createElement('span');
    text.textContent = label;
    button.append(text);
    button.onclick = () => onSelect(id);
    return button;
  });
  container.replaceChildren(...buttons);
}
