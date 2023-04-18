var DEBUG = false;

const originalLog = console.log;

console.log =
  DEBUG
  ? (...args) => originalLog(...args)
  : () => undefined

const pagetypeEnum = {
  EPISODELISTING: { val: "pagetype.EPISODELISTING" },
  VIDEO: { val: "pagetype.VIDEO" },
  OTHER: { val: "pagetype.OTHER" },
};

const syncEveryMs = 1 * 60 * 1000; // 1 minute
let lastSync = Date.now();

String.prototype.match_safe = function(regex) {
  return this.match(regex) || [];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitUntil = async (f, ms) => {
  if (f()) {
    return;
  } else {
    await sleep(ms || 1000);
    return waitUntil(f, ms);
  }
}

// deconstructing the url to help us understand what we're doing
// these may be undefined
const path = window.location.pathname;
const show = path.match_safe(/^\/([^\/]+)/)[1];
const video = path.match_safe(/\/videos\/([^\/]+)/)[1];
const season = path.match_safe(/\/(season[^\/]+)/)[1];

const hasSeasonPicker = 0 !== document.getElementsByClassName('js-switch-season').length;
const pagetype =
  video
  ? pagetypeEnum.VIDEO
  : hasSeasonPicker
    ? pagetypeEnum.EPISODELISTING
    : pagetypeEnum.OTHER;

const Entry = (time) => {
    return { currentTime: time }
}

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
  chrome.storage.local.get(k, (entry) => {
    if(entry) {
      resolve(entry[k]);
    } else {
      chrome.storage.sync.get(k, (entry) => resolve(entry[k]));
    }
  });
});

const handlePlay = async () => {
  const player = VHX.Player('watch-embed');

  // the call to VHX.Player doesn't block until the browser has loaded
  // everything, so our attempt to set the player time to the stored value can
  // be lost! We use the videoduration to see if everything is ready before
  // progressing. This loop will generally run quite a few times at 50ms before
  // succeeding (between 1 and 50 times).
  await waitUntil(() => undefined !== player.getVideoDuration(), 50);

  const savedEntry = await get(path);
  // Compatibility: we used to just store the current time directly
  const savedTime = typeof savedEntry === "number" ? savedEntry : savedEntry?.currentTime;
  if(savedTime) {
    player.currentTime(savedTime);
  }

  player.on('timeupdate', (e,time) => {
    save(path, Entry(time));
  });

  if(season){
    const showSeasonKey = `${show}\season`;
    save(showSeasonKey, { lastWatchedSeason: season });
  }
}

const secondsFromDurationString = (duration) => {
  const partsIncreasing = duration.split(':').reverse();
  [seconds,] = partsIncreasing.reduce(([value, radix], part) => [value + part * radix, radix * 60], [0, 1]);
  return seconds;
}

const handleListing = async () => {
  if(!season) {
    const storedSeason = await get(`${show}\season`);
    if(storedSeason) {
      window.location.pathname = `${show}/${storedSeason.lastWatchedSeason}`;
      return;
    }
  }

  // Might be overly specific, but better that than the alternative. The link
  // contains the thumbnail image, but isn't the whole card (the episode title
  // is outside this element)
  const videos = document.querySelectorAll('li[data-item-type="video"] div.grid-item-padding a.browse-item-link');
  const entryPromises = [...videos].map( async (v) => {
    const path = new URL(v.href).pathname;
    const entry = await get(path);
    return [v, entry];
  });
  const videoEntries = await Promise.all(entryPromises);
  videoEntries.forEach(([video, entry]) => {
    if(undefined === entry) {
      return;
    }

    const duration = secondsFromDurationString(video.querySelector('.duration-container').innerHTML.trim());
    // Compatibility: we used to just store the current time directly
    const currentTime = typeof entry === 'number' ? entry : entry.currentTime;
    const currentTimePercent = currentTime / duration;

    const isSeen = currentTimePercent >= 0.94;
    const overlay = isSeen ? document.createElement('SPAN') : undefined;
    if(isSeen) {
      const oStyle = overlay.style;
      oStyle.backgroundColor = 'black';
      oStyle.opacity = 0.8;
      oStyle.position = 'absolute';
      oStyle.top = '0';
      oStyle.bottom = '0';
      oStyle.left = '0';
      oStyle.right = '0';
    }

    const progressBar = document.createElement('SPAN');
    const pStyle = progressBar.style;
    pStyle.backgroundColor = 'red';
    pStyle.position = 'absolute';
    pStyle.height = '1px';
    pStyle.bottom = '-1px';
    pStyle.left = '0px';
    pStyle.right = `${100 * (1 - currentTimePercent)}%`;

    const progressUnderlay = progressBar.cloneNode();
    const puStyle = progressUnderlay.style;
    puStyle.backgroundColor = 'black';
    puStyle.height = '1px';
    puStyle.bottom = '-1px';
    puStyle.right = '0px';

    if(isSeen) {
      video.appendChild(overlay);
    }
    video.appendChild(progressUnderlay);
    video.appendChild(progressBar);
  });
}

if (pagetype === pagetypeEnum.VIDEO){
  handlePlay();
} else if (pagetype === pagetypeEnum.EPISODELISTING) {
  handleListing();
}
