/*
Parallel Bible Versions Plugin
===============
Display parallel bible versions for the selected scripture reference.
*/

/** External api from jwl-linker
 *  @typedef {import('jwl.d.ts').api} api 
 */

const { Plugin, ItemView, setTooltip, setIcon, requestUrl, Notice } = require('obsidian');

const BIBLE_VERSION_VIEW = 'bible-version-view';

const Config = {
  url: 'https://www.biblegateway.com/verse/en/',
  sep1: ' | ',
  sep2: ' • ',
  delay: 3000,
};

const Lang = {
  name: 'Bible Versions',
  introHdr: 'Bible Versions',
  intro: 'Show parallel Bible versions for a given verse reference.',
  source: 'Sourced from <a href="https://www.biblegateway.com/">BibleGateway</a>',
  invalidScripture: 'The scripture reference is not a valid Bible verse',
  noResult: 'Could not find a matching scripture',
  noEditor: 'No active editor',
  searching: 'Searching for parallel versions from Bible Gateway...',
  searchPlc: 'Find parallel bible verses...',
  clearTip: 'Clear search',
  findCursorTip: 'Find scripture at cursor',
  findCursorTxt: 'Click the button beside the search box to find the word at the cursor position',
  copyVerseTxt: 'Click verse text in any version to copy it to the clipboard',
  clearTxt: 'Click here to clear the search history.',
  copiedVerseMsg: 'The verse text was copied to the clipboard',
  hideTip: 'Click to hide',
  help: 'Help'
};

const DEFAULT_SETTINGS = {
  maxHistory: 25, // hard coded for now
}

class BibleVersionPlugin extends Plugin {
  constructor() {
    super(...arguments);
  }

  async onload() {
    await this.loadSettings();

    this.registerView(
      BIBLE_VERSION_VIEW, 
      (leaf) => new BibleVersionView(leaf, this.settings),
    );

    this.addCommand({
      id: 'bible-version-open',
      name: 'Open sidebar',
      callback: this.activateView.bind(this),
    });
    // biome-ignore lint: Loading indicator, runs once only; // ⚠️
    console.log(`%c${this.manifest.name} ${this.manifest.version} loaded`, 
      'background-color: royalblue; padding:4px; border-radius:4px');
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(BIBLE_VERSION_VIEW).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false); // false => no split
      await leaf.setViewState({
          type: BIBLE_VERSION_VIEW,
          active: true,
        });
    }
    workspace.revealLeaf(leaf);
  }
}

class BibleVersionView extends ItemView {
  constructor(leaf, settings) {
    super(leaf);
    this.settings = settings;
    this.cache = {};
    this.searchboxEl;
    this.historyEl;
    this.history = [];
    this.helpEl;
    this.expandHelpEl;
    this.helpExpanded = true;

    /** @type {api} */
    this.jwl = this.app.plugins.plugins['jwl-linker']?.api;
  }

  getViewType() {
    return BIBLE_VERSION_VIEW;
  }

  getDisplayText() {
    return Lang.name;
  }

  getIcon() {
    return 'library';
  }

  // Update state from workspace
  async setState(state, result) {
    if (state.lookup) {
      this.searchboxEl.value = state.lookup;
    }
    this.history = state.history ?? [];
    this.showHistory();
    await super.setState(state, result);
  }

  // Save state to workspace
  getState() {
    const state = super.getState();
    state.lookup = this.searchboxEl.value;
    state.history = this.history;
    return state;
  }

  async onOpen() {
    // SEARCH BAR
    const rowEl = createDiv({ cls: 'search-row' });
    const contEl = rowEl.createDiv({ cls: 'search-input-container' });
    const searchboxEl = contEl.createEl('input', {
      type: 'search',
      placeholder: Lang.searchPlc,
    });
    this.searchboxEl = searchboxEl;
    const clearEl = contEl.createDiv({
      cls: 'search-input-clear-button',
    });
    setTooltip(clearEl, Lang.clearTip);
    const cursorBtn = rowEl.createDiv({ cls: 'clickable-icon pbv-cursor-icon' });
    setIcon(cursorBtn, 'text-cursor-input');
    setTooltip(cursorBtn, Lang.findCursorTip, { placement: 'bottom' });
    this.containerEl.prepend(rowEl);  // place at top to ensure it stays fixed

    // PLUGIN CONTENT CONTAINER
    this.contentEl.empty();
    this.contentEl.addClass('pbv');

    // START VIEW
    const introEl = this.contentEl.createDiv();
    const historyEl = introEl.createEl('div', { cls: 'pbv-history'});
    this.historyEl = historyEl;
    
    // SEARCHING MESSAGE VIEW
    const searchingEl = this.contentEl.createDiv({
      cls: 'pbv-message',
      text: Lang.searching,
    });
    searchingEl.hide();
    
    // RESULTS VIEW
    const resultEl = this.contentEl.createDiv({ cls: 'pbv-results' });
    
    // HELP TOGGLE
    const detailsEl = createEl('details');
    detailsEl.createEl('summary', { text: Lang.help });
    detailsEl.createEl('p', { text: Lang.intro });
    const detailEl = detailsEl.createEl('ul');
    detailEl.createEl('li', { text: Lang.findCursorTxt });
    detailEl.createEl('li', { text: Lang.copyVerseTxt });
    const wipeEl = detailEl.createEl('li', { text: Lang.clearTxt, cls: 'clear-history' });

    this.contentEl.append(detailsEl);


    /* ⚒️ INTERNAL FUNCTIONS */

    /**
     * Display the verse list in the sidebar
     * Displays a notice for invalid verses
     * Used by the events below
     * @param {string} lookup Must be a full, valid scripture reference
     */
    const showResults = async (lookup) => {
      if (lookup !== '') {
        searchboxEl.value = lookup;
        searchboxEl.addClass('pbv-active-verse');
        introEl.hide();
        let results = [];
        /** @type {TLookup} */
        const cache = this.getFromHistory(lookup);
        if (cache) {
          results = cache.results;
        } else {
          searchingEl.show();
          results = await this.fetchBibleVersions(lookup);
          searchingEl.hide();
        }
        if (results) {
          resultEl.empty();
          for (const { version, text } of results) {
            const rowEl = resultEl.createDiv({ cls: 'pbv-row' });
            rowEl.createSpan({ text: version, cls: 'pbv-ver' });
            rowEl.createSpan({ text: text, cls: 'pbv-text' });
          }
          resultEl.createDiv({ text: '🔹' });
          this.addToHistory(lookup, results);
          this.showHistory();
        } else {
          resultEl.createDiv({ text: Lang.noResult, cls: 'pbv-none' });
        }
      } else {
        new Notice(Lang.invalidScripture, Config.delay);
      }
    }
    
    /* EVENTS */
 
    // three different ways to trigger a search

    searchboxEl.onsearch = async () => {
      const lookup = this.getScriptureFromSearch(searchboxEl.value);
      showResults(lookup);
    };   

    cursorBtn.onclick = () => {
      const view = this.app.workspace.getMostRecentLeaf().view;
      const lookup = this.getScriptureAtCursor(view);
      showResults(lookup);
    };
    
    clearEl.onclick = (event) => {
      searchboxEl.removeClass('pbv-active-verse');
      searchboxEl.value = '';
      resultEl.empty();
      introEl.show();
    };

    historyEl.onclick = (event) => {
      if (event.target.tagName === 'SPAN') {
        showResults(event.target.textContent);
      }
    }

    wipeEl.onclick = () => {
      this.clearHistory();
      clearEl.onclick();
    }

    resultEl.onclick = (event) => {
      if (event.target.className === 'pbv-text') {
        navigator.clipboard.writeText(
          `${event.target.textContent}\n*${event.target.previousSibling.textContent.trim()}*`);
        new Notice(Lang.copiedVerseMsg, 2000);
      }
    }
  }
  
  async onClose() {
    this.unload();
  }
  
  /* 🕒 HISTORY FUNCTIONS */

  /** @typedef {{ lookup: string, results: Array }} TLookup */

  showHistory() {
    this.historyEl.empty();
    for (const item of this.history) {
      this.historyEl.createEl('span', { text: item.lookup });
    }
  }

  addToHistory(lookup, results) {
    /** @type {TLookup} */
    const newItem = { lookup, results };
    this.history = this.history.filter(item => lookup !== item.lookup); // no duplicates
    this.history = [newItem, ...this.history]; // add to the top
    if (this.history.length > this.settings.maxHistory) {
      this.history = this.history.slice(0, this.settings.maxHistory);
    }
  }

  getFromHistory(lookup) {
    const cache = this.history.find((item) => item.lookup === lookup);
    return cache;
  }

  clearHistory() {
    this.history = [];
    this.getState();
    this.showHistory();
  }

  /* 📦 INTERNAL FUNCTIONS */
  
  /**
   * Try to validate a scripture reference entered by user into search box
   *
   * @param {string} input
   * @returns {string} validated scripture reference; empty if no match
   */
  getScriptureFromSearch(input) {
    /** @type {import('jwl.d.ts').TReference} */
    const match = this.jwl.getAllScriptureLinks(input, this.jwl.DisplayType.find);
    return match ? match.passages[0].display : '';
  }

  /**
   * Try to find and validate a scripture reference from the cursor position
   *
   * @param {obsidian.View} view current editor view
   * @returns {string} validated scripture reference; empty if no match
   */
  getScriptureAtCursor(view) {
    let lookup = '';
    if (view) {
      const offset = 25; // ± overlap based on longest scripture reference I can think of
      const editor = view.editor;
      const cursor = editor.getCursor();
      const line = editor.getLine(cursor.line);
      let caret = cursor.ch;
      const begin = caret - offset < 0 ? 0 : caret - offset;
      const end = caret + offset > line.length ? line.length : caret + offset;
      caret -= begin;
      const fragment = line.slice(begin, end);
      /** @type {import('jwl.d.ts').TReference} */
      const match = this.jwl.getAllScriptureLinks(fragment, this.jwl.DisplayType.find, caret);
      lookup = match ? match.passages[0].display : '';
    } else {
      new Notice(Lang.noEditor, Config.delay);
    }
    return lookup;
  }

  /**
   * Fetch the bible versions for the input scripture
   * @param {string} lookup Scripture, must be full and valid!
   * @returns {array|null} innerHTML of each version of the verse, null on failure
   */
  async fetchBibleVersions(lookup) {
    const url = Config.url + lookup;
    const results = [];
    try {
      const res = await requestUrl(url);
      if (res.status === 200) {
        const source = res.text;
        const dom = new DOMParser().parseFromString(source, 'text/html');
        const versions = dom.querySelectorAll('.singleverse-row');
        for (const elem of versions) {
          results.push(this.extractPlainText(elem.innerHTML));
        }
        return results;
      }
    } catch (error) {
      // biome-ignore lint: ; // ⚠️
      console.log(error);
    }
    return null;
  }

  /**
   * Extracts the plain text from the html markup
   * Separates the version abbreviation from the text
   * Builds a full version name (abbr. + full name)
   * 
   * @param {string} html html markup
   * @returns {{version, text}} bible version name, full text of verse
   */
  extractPlainText(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let version = doc.body.childNodes[0].textContent ?? '';
    version = Config.sep1 + version + Config.sep2 + BibleVersions[version] ?? '';
    let text = doc.body.childNodes[1].textContent ?? '';
    text = text.replace('¶', '');
    return { version, text };
  }

}

const BibleVersions = {
  AKJV: 'Authorized (King James) Version',
  AMP: 'Amplified Bible ',
  AMPC: 'Amplified Bible, Classic Edition ',
  ASV: 'American Standard Version ',
  BRG: 'BRG Bible ',
  CEB: 'Common English Bible ',
  CEV: 'Contemporary English Version ',
  CJB: 'Complete Jewish Bible ',
  CSB: 'Christian Standard Bible ',
  DARBY: 'Darby Translation ',
  DLNT: 'Disciples’ Literal New Testament ',
  DRA: 'Douay-Rheims 1899 American Edition ',
  EASY: 'EasyEnglish Bible ',
  EHV: 'Evangelical Heritage Version ',
  ERV: 'Easy-to-Read Version ',
  ESV: 'English Standard Version ',
  ESVUK: 'English Standard Version Anglicised ',
  EXB: 'Expanded Bible ',
  GNT: 'Good News Translation ',
  GNV: '1599 Geneva Bible ',
  GW: 'GOD’S WORD Translation ',
  HCSB: 'Holman Christian Standard Bible ',
  ICB: 'International Children’s Bible ',
  ISV: 'International Standard Version ',
  JUB: 'Jubilee Bible 2000 ',
  KJ21: 'Century King James Version ',
  KJV: 'King James Version ',
  LEB: 'Lexham English Bible ',
  LSB: 'Legacy Standard Bible ',
  MEV: 'Modern English Version ',
  MOUNCE: 'Mounce Reverse Interlinear New Testament ',
  MSG: 'The Message ',
  NABRE: 'New American Bible (Revised Edition) ',
  NASB: 'New American Standard Bible ',
  NASB1995: 'New American Standard Bible 1995 ',
  NCB: 'New Catholic Bible ',
  NCV: 'New Century Version ',
  NET: 'New English Translation ',
  NIRV: "New International Reader's Version ",
  NIV: 'New International Version ',
  NIVUK: 'New International Version - UK ',
  NKJV: 'New King James Version ',
  NLT: 'New Living Translation ',
  NLV: 'New Life Version ',
  NMB: 'New Matthew Bible ',
  NOG: 'Names of God Bible ',
  NRSVA: 'New Revised Standard Version, Anglicised ',
  NRSVACE: 'New Revised Standard Version, Anglicised Catholic Edition ',
  NRSVCE: 'New Revised Standard Version Catholic Edition ',
  NRSVUE: 'New Revised Standard Version Updated Edition ',
  NTFE: 'New Testament for Everyone ',
  OJB: 'Orthodox Jewish Bible ',
  PHILLIPS: 'J.B. Phillips New Testament ',
  RGT: 'Revised Geneva Translation ',
  RSV: 'Revised Standard Version ',
  RSVCE: 'Revised Standard Version Catholic Edition ',
  TLB: 'Living Bible ',
  TLV: 'Tree of Life Version ',
  VOICE: 'The Voice ',
  WE: 'Worldwide English (New Testament)',
  WEB: 'World English Bible ',
  WYC: 'Wycliffe Bible ',
  YLT: "Young's Literal Translation ",
};

module.exports = {
  default: BibleVersionPlugin,
};
