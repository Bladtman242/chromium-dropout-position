const url = window.location.pathname;

const syncEveryMs = 1 * 60 * 1000; // 1 minute
let lastSync = Date.now();


const save = (k, v) => new Promise(resolve => {
  const entry = {};
  entry[k] = v;
  chrome.storage.local.set(entry, resolve);
  if (lastSync < Date.now() - syncEveryMs) {
    lastSync = Date.now();
    chrome.storage.sync.set(entry, resolve);
  }
});

const get = k => new Promise(resolve => {
  chrome.storage.local.get((entry) => {
    if(entry) {
      resolve(entry[k]);
    } else {
      chrome.storage.sync.get((entry) => resolve(entry[k]));
    }
  });
});

const  f = async () => {
  const player = VHX.Player('watch-embed');
  const savedTime = await get(url);
  if(savedTime) {
    player.currentTime(savedTime);
  }
  player.on('timeupdate', (e,time) => save(url, time));
};

window.addEventListener('load', () => setTimeout(f, 400));
