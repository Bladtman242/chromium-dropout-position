var DEBUG = false;

// "fixes" firefox bug: https://bugzilla.mozilla.org/show_bug.cgi?id=1372649
window.addEventListener = window.addEventListener.bind(window);

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

const syncEveryMs = 1.2 * 1/(1800/60/60/1000); // limited to 1800 calls per hour, with a 20% margin for our sake
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

const removeBulk = async (entries) => {
  await chrome.storage.local.remove(entries);
  await chrome.storage.sync.remove(entries);
}

const saveBulk = async (entries) => {
  await chrome.storage.local.set(entries);
  try {
    await chrome.storage.sync.set(entries);
  } catch {
  }
};

const getBulk = async keys => {
  const entries_local = await chrome.storage.local.get(keys);
  const entries_sync = await chrome.storage.sync.get(keys);
  const entries = {
    ...entries_local,
    ...entries_sync,
  };
  await saveBulk(entries);
  return entries;
};

const save = async (k, v) => {
  const entry = {
    [k]: v
  };
  await chrome.storage.local.set(entry);
  if (lastSync < Date.now() - syncEveryMs) {
    lastSync = Date.now();
    await chrome.storage.sync.set(entry);
  }
};

const get = async k => {
  const entry = await chrome.storage.local.get(k);
  if(entry) {
    return entry[k];
  } else {
    const entry = await chrome.storage.sync.get(k);
    return entry[k];
  }
};

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

  player.on('timeupdate', async (e,time) => {
    await save(path, Entry(time));
  });

  if(season){
    const showSeasonKey = `${show}\season`;
    await save(showSeasonKey, { lastWatchedSeason: season });
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

  delteBuiltInProgressBars();
  insertEpisodeOverlays();
  insertMarkSeasonAsSeen();
}

const getVideoThumbnails = () => {
  // Might be overly specific, but better that than the alternative. The link
  // contains the thumbnail image, but isn't the whole card (the episode title
  // is outside this element)
  const videos = document.querySelectorAll('li[data-item-type="video"] div.grid-item-padding a.browse-item-link');
  const withPaths = [...videos].map( (video) => {
    const duration = secondsFromDurationString(video.querySelector('.duration-container').innerHTML.trim());
    const path = new URL(video.href).pathname;
    return {
      video,
      path,
      duration,
    };
  });
  return withPaths;
}

const delteBuiltInProgressBars = async () => {
  [...document.getElementsByClassName('percentage-bar-container')]
    .forEach( (e) => { e.remove() });
}

const insertEpisodeOverlays = async () => {
  const videos = getVideoThumbnails();

  const entryKeys = videos.map((v) => v.path);
  const entries = await getBulk(entryKeys);
  const videoEntries = videos.map((v) => {
    return {
      ...v,
      entry: entries[v.path],
    }
  });

  videoEntries.forEach(({ video, duration, entry }) => {
    if(undefined === entry) {
      return;
    }

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
    puStyle.right = '0px';

    if(isSeen) {
      video.appendChild(overlay);
    }
    video.appendChild(progressUnderlay);
    video.appendChild(progressBar);
  });
}

const insertMarkSeasonAsSeen = () => {
  const containerDiv = document.querySelectorAll('.season-controls .grid-padding-left')[0];
  const form = document.createElement('FORM');
  const select = document.createElement('SELECT');

  form.classList.add('select-dropdown-wrapper');
  form.setAttribute('autocomplete', 'off');

  select.classList.add('btn-dropdown-transparent');
  form.appendChild(select);

  const markAs = async (f) => {
    if(!confirm('Are you sure? This will overwrite the stored progress for all episodes in this season.')) {
      return;
    }

    const videos = getVideoThumbnails();
    const entries = {};
    const toRemove = [];

    videos.forEach((v) => {
      const key = v.path;
      const entry = Entry(f(v));

      if (entry.currentTime === 0) {
        toRemove.push(key);
      } else {
        entries[key] = entry;
      }
    })

    const savePromise = saveBulk(entries);
    const removePromise = removeBulk(toRemove);
    Promise.all([savePromise, removePromise]);
    location.reload();
  };

  const buttons = {
    'dropout-progress': () => {},
    'mark season as watched': () => markAs((v) => v.duration),
    'mark season as new': () => markAs(() => 0),
  };

  Object.entries(buttons).forEach(([text, clickHandler]) => {
    const button = document.createElement('OPTION');
    button.setAttribute('value', text);
    button.innerText=text;
    select.appendChild(button);
  });

  select.addEventListener('change', (event) => {
    buttons[event.target.value]()
  });


  containerDiv.appendChild(form);
}

if (pagetype === pagetypeEnum.VIDEO){
  handlePlay();
} else if (pagetype === pagetypeEnum.EPISODELISTING) {
  handleListing();
}
