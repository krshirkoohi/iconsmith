#!/usr/bin/osascript -l JavaScript
// Iconsmith Mac helper: apply or restore custom icons on files and folders.
// Uses only the built-in macOS scripting runtime (no Xcode needed).
//
//   osascript -l JavaScript iconsmith-apply.js apply <icon.icns|png> <file-or-folder> [more...]
//   osascript -l JavaScript iconsmith-apply.js clean <file-or-folder> [more...]
//
// MIT licence.
ObjC.import('AppKit');

function run(argv) {
  const usage = [
    'Usage:',
    '  osascript -l JavaScript iconsmith-apply.js apply <icon.icns|png> <file-or-folder> [more...]',
    '  osascript -l JavaScript iconsmith-apply.js clean <file-or-folder> [more...]'
  ].join('\n');
  if (argv.length < 2) return usage;

  const fm = $.NSFileManager.defaultManager;
  const ws = $.NSWorkspace.sharedWorkspace;
  const cwd = fm.currentDirectoryPath.js;
  const abs = (p) => {
    let path = $(p).stringByExpandingTildeInPath.js;
    if (!path.startsWith('/')) path = cwd + '/' + path;
    return $(path).stringByStandardizingPath.js;
  };
  const lines = [];
  const command = argv[0];

  if (command === 'apply') {
    if (argv.length < 3) return usage;
    const iconPath = abs(argv[1]);
    const image = $.NSImage.alloc.initWithContentsOfFile(iconPath);
    if (image.isNil()) return 'Could not read image: ' + iconPath;
    for (const target of argv.slice(2)) {
      const path = abs(target);
      if (!fm.fileExistsAtPath(path)) { lines.push('Not found: ' + path); continue; }
      lines.push((ws.setIconForFileOptions(image, path, 0) ? 'Applied: ' : 'Failed: ') + path);
    }
  } else if (command === 'clean') {
    for (const target of argv.slice(1)) {
      const path = abs(target);
      if (!fm.fileExistsAtPath(path)) { lines.push('Not found: ' + path); continue; }
      // Passing nil removes the custom icon and restores the default one.
      lines.push((ws.setIconForFileOptions($(), path, 0) ? 'Restored: ' : 'Failed: ') + path);
    }
  } else {
    return usage;
  }
  return lines.join('\n');
}
