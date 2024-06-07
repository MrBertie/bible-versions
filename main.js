/*
Parallel Bible Versions Plugin
===============
Display parallel bible versions for the selected scripture reference.
*/

/** External api from jwl-linker
 *  @typedef {import('jwl.d.ts').api} api 
 */

const { Plugin, ItemView, setTooltip, requestUrl, Notice } = require('obsidian');

const BIBLE_VERSION_VIEW = 'bible-version-view';

const Config = {
  url: 'https://www.biblegateway.com/verse/en/',
  sep1: ' | ',
  sep2: ' • ',
  delay: 3000,
};

const Lang = {
  name: 'Bible Versions',
  clearTip: 'Clear search',
  introHdr: 'Bible Versions',
  intro: 'Show parallel Bible versions for a scripture reference.',
  source: 'Source: <a href="https://www.biblegateway.com/">BibleGateway</a>',
  invalidScripture: 'The scripture reference is not a valid Bible verse',
  noResult: 'Could not find a matching scripture',
  noEditor: 'No active editor',
  searching: 'Searching for parallel versions from Bible Gateway...',
  searchPlc: 'Enter a scripture reference...',
  selected: 'Find scripture at the cursor',
};

class BibleVersionPlugin extends Plugin {
  constructor() {
    super(...arguments);
  }

  async onload() {
    this.registerView(
      BIBLE_VERSION_VIEW, 
      (leaf) => (this.view = new BibleVersionView(leaf)),
    );

    this.app.workspace.onLayoutReady(this.activateView.bind(this));

    console.log('%c' + this.manifest.name + ' ' + this.manifest.version +
      ' loaded', 'background-color: royalblue; padding:4px; border-radius:4px');
  }

  onunload() {}

  async activateView() {
    const { workspace } = this.app;
    const [leaf] = workspace.getLeavesOfType(BIBLE_VERSION_VIEW);
    if (!leaf) {
      await this.app.workspace
        .getRightLeaf(false) // false = no split
        .setViewState({
          type: BIBLE_VERSION_VIEW,
          active: true,
        });
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }
}

class BibleVersionView extends ItemView {
  constructor(leaf) {
    super(leaf);

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

  async onOpen() {
    this.contentEl.empty();

    // SEARCH BAR
    const nav = this.contentEl.createDiv({ cls: 'nav-header'});
    const row = nav.createDiv({ cls: 'search-row' });
    const cont = row.createDiv({ cls: 'search-input-container' });
    const search_box = cont.createEl('input', {
      type: 'search',
      placeholder: Lang.searchPlc,
    });
    const search_clear = cont.createDiv({
      cls: 'search-input-clear-button',
    });
    setTooltip(search_clear, Lang.clearTip);

    // PLUGIN CONTAINER
    const content = this.contentEl.createDiv({ cls: 'bible-version-plugin' });

    // START VIEW
    const start_view = content.createDiv();
    start_view.createDiv({ text: Lang.introHdr.toUpperCase(), cls: 'pbv-title' });
    start_view.createDiv({ text: Lang.intro, cls: 'pbv-intro' });
    start_view.createDiv({ cls: 'pbv-source' }).innerHTML = Lang.source;
    const selected_btn = start_view.createEl('button', {
      text: Lang.selected,
      cls: 'pbv-button',
    });

    // RESULTS VIEWS
    const searching_view = content.createDiv({
      text: Lang.searching,
      cls: 'pbv-message',
    });
    searching_view.hide();

    const result_view = content.createDiv();

    // EVENTS
    // ******

    search_box.onsearch = () => {
      const lookup = Lib.scriptureFromSearch(search_box.value, this.jwl);
      showResults(lookup);
    };

    selected_btn.onclick = () => {
      const view = this.app.workspace.getMostRecentLeaf().view;
      const lookup = Lib.scriptureFromCursor(view, this.jwl);
      showResults(lookup);
    };

    search_clear.onclick = () => {
      search_box.value = '';
      result_view.empty();
      start_view.show();
    };

    /**
     * Display the verse list in the sidebar
     * Signals invalid verses
     * 
     * @param {string} lookup Must be a full , valid scripture reference
     */
    function showResults(lookup) {
      if (lookup !== '') {
        search_box.value = lookup;
        start_view.hide();
        searching_view.show();
        Lib.fetchBibleVersions(lookup).then((results) => {
          searching_view.hide();
          result_view.empty();
          if (results !== undefined) {
            result_view.createDiv({ text: lookup.toUpperCase(), cls: 'pbv-title' });
            results.forEach(({ version, text }) => {
              const row = result_view.createDiv({ cls: 'pbv-row' });
              row.createSpan({ text: version, cls: 'pbv-ver' });
              row.createSpan({ text: text, cls: 'pbv-text' });
            });
            result_view.createDiv({ text: '🔹' });
          } else {
            result_view.createDiv({ text: Lang.noResult, cls: 'pbv-none' });
          }
        });
      } else {
        new Notice(Lang.invalidScripture, Config.delay);
      }
    }
  }

  async onClose() {
    this.unload();
  }
}

/**
 * Static local function library
 */
class Lib {
  /**
   * Fetch the bible versions for the input scripture
   * @param {string} lookup Scripture, must be full and valid!
   * @returns {array|null} innerHTML of each version of the verse
   */
  static async fetchBibleVersions(lookup) {
    const url = Config.url + lookup;
    let result = [];
    try {
      const res = await requestUrl(url);
      if (res.status === 200) {
        const source = res.text;
        const dom = new DOMParser().parseFromString(source, 'text/html');
        const versions = dom.querySelectorAll('.singleverse-row');
        versions.forEach((elem) => {
          result.push(this.extractPlainText(elem.innerHTML));
        });
        return result;
      }
    } catch (error) {
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
  static extractPlainText(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    let version = doc.body.childNodes[0].textContent ?? '';
    version = Config.sep1 + version + Config.sep2 + BibleVersions[version] ?? '';
    let text = doc.body.childNodes[1].textContent ?? '';
    text = text.replace('¶', '');
    return { version, text };
  }

  /**
   * Try to validate a scripture reference entered by user into search box
   *
   * @param {string} input
   * @param {api} api jwl-linker api
   * @returns {string} empty if no match
   */
  static scriptureFromSearch(input, api) {
    const match = api.matchPotentialScriptures(input)[0] ?? null;
    if (match) {
      const result = api.validateScripture(match, api.DisplayType.first);
      return result.display;
    } else {
      return '';
    }
  }

  /**
   * Try to find and validate a scripture reference from the cursor position
   *
   * @param {obsidian.View} active_view curernt editor view
   * @param {api} jwl jwl-linker api
   * @returns {string} empty if no match
   */
  static scriptureFromCursor(active_view, jwl) {
    let result; 
    let lookup = '';
    if (active_view) {
      const offset = 25; // ± based on longest scripture reference I can think of
      const editor = active_view.editor;
      const cursor = editor.getCursor();
      const line = editor.getLine(cursor.line);
      let loc = cursor.ch;
      const begin = loc - offset < 0 ? 0 : loc - offset;
      const end = loc + offset > line.length ? line.length : loc + offset;
      loc -= begin;
      const fragment = line.slice(begin, end);
      const matches = jwl.matchPotentialScriptures(fragment);
      if (matches.length) {
        for (const match of matches) {
          // Is the cursor within or at the end of this scripture?
          if (loc >= match.begin && loc <= match.end) {
            result = jwl.validateScripture(match, jwl.DisplayType.first);
            lookup = result.display;
            break;
          }
        }
      }
    } else {
      new Notice(Lang.noEditor, Config.delay);
    }
    return lookup;
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
