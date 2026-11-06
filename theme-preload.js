'use strict';
// Hidden export and non-interactive outlines only need palette synchronization.
const {ipcRenderer}=require('electron');
require('./lib/theme-preload').installThemeBridge({ipcRenderer,document,window});
