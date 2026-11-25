'use strict';
const tool = new URLSearchParams(location.search).get('tool');
if (['calendar', 'markdown'].includes(tool)) {
  document.documentElement.classList.add('tool-window');
  document.documentElement.dataset.tool = tool;
} else {
  document.documentElement.classList.add('workbench');
}
