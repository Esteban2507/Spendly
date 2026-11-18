const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  let active;
  const changes = [];
  const statuses = [];
  const accounts = new Map();
  const server = new Map();
  const profile = () => accounts.get(active);
  const api = {
    State: {},
    switchProfile(uid) {
      active = uid;
      if (!accounts.has(uid)) accounts.set(uid, { base: undefined, state: {} });
      api.State = profile().state;
      return {};
    },
    getProfile: () => active,
    getCloudBaseline: () => profile().base,
    isCloudDirty: () => Boolean(profile().dirty),
    replaceFromCloud(state, revision, uid) {
      assert.equal(uid, active);
      accounts.set(uid, { state, base: revision, dirty: false });
      api.State = state;
      changes.push({ action: 'replace', uid, revision });
      return true;
    },
    saveCloudBaseline(revision, uid) {
      assert.equal(uid, active);
      profile().base = revision;
      return true;
    },
    Cloud: {
      setActiveUser() {},
      pause() {},
      resume() {},
      loadFromCloud: async (uid) => server.get(uid),
      reportStatus: (phase) => statuses.push(phase),
      scheduleSave: (uid, _state, revision) => changes.push({ action: 'save', uid, revision })
    }
  };
  const source = fs.readFileSync(require.resolve('../js/account.js'), 'utf8');
  vm.runInNewContext(source, { window: { Spendly: api } });
  return { api, account: api.Account, server, accounts, changes, statuses };
}

test('a clean cached account accepts the latest server version', async () => {
  const { account, server, accounts, changes } = setup();
  accounts.set('a', { base: 'one', state: { expenses: ['old'] }, dirty: false });
  server.set('a', { revision: 'two', state: { expenses: ['new'] } });
  account.open('a');
  assert.equal(await account.reconcile(), true);
  assert.deepEqual(changes, [{ action: 'replace', uid: 'a', revision: 'two' }]);
});

test('a changed server revision never overwrites local pending data without a decision', async () => {
  const { account, server, accounts, changes, statuses } = setup();
  accounts.set('a', { base: 'one', state: { expenses: ['local'] }, dirty: true });
  server.set('a', { revision: 'two', state: { expenses: ['remote'] } });
  account.open('a');
  assert.equal(await account.reconcile(), false);
  assert.equal(statuses.at(-1), 'conflict');
  assert.equal(changes.length, 0);
  assert.deepEqual(accounts.get('a').state.expenses, ['local']);
  assert.equal(await account.reconcile({ useCloud: true }), true);
  assert.deepEqual(accounts.get('a').state.expenses, ['remote']);
});

test('a confirmed missing account document can receive pending offline data', async () => {
  const { account, server, accounts, changes } = setup();
  accounts.set('a', { base: undefined, state: { expenses: ['local'] }, dirty: true });
  server.set('a', { revision: null, state: null });
  account.open('a');
  assert.equal(await account.reconcile(), true);
  assert.equal(accounts.get('a').base, null);
  assert.deepEqual(changes, [{ action: 'save', uid: 'a', revision: null }]);
});

test('a delayed cloud response is ignored after login to a different account', async () => {
  const { account, server, changes, api } = setup();
  let release;
  server.set('a', new Promise((resolve) => { release = resolve; }));
  account.open('a');
  const late = account.reconcile();
  account.open('b');
  server.set('b', { revision: 'b-revision', state: { expenses: ['B'] } });
  await account.reconcile();
  release({ revision: 'a-revision', state: { expenses: ['A'] } });
  assert.equal(await late, false);
  assert.deepEqual(api.State.expenses, ['B']);
  assert.deepEqual(changes, [{ action: 'replace', uid: 'b', revision: 'b-revision' }]);
});
