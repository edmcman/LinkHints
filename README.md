# Link Hints

<img src="icon.svg" alt="" align="left" style="margin-right: 1em;">

A browser extension that lets you click with your keyboard.

**[Website] | [Changelog] | [Contributing]**

**[Add to Firefox] | [Add to Chrome]**

[add to chrome]: https://chrome.google.com/webstore/detail/link-hints/kjjgifdfplpegljdfnpmbjmkngdilmkd
[add to firefox]: https://addons.mozilla.org/firefox/addon/LinkHints/
[changelog]: https://github.com/lydell/LinkHints/issues/1
[contributing]: CONTRIBUTING.md
[website]: https://lydell.github.io/LinkHints

## Linux Chrome automatic updates

The `main` builds are published at <https://edmcman.github.io/LinkHints/>. The update feed is <https://edmcman.github.io/LinkHints/update.xml> and the extension ID is in <https://edmcman.github.io/LinkHints/extension-id.txt>. These files are public.

To install, read the ID from that URL, then create `/opt/google/chrome/extensions/<extension-id>.json` (substitute the ID) with:

```json
{ "external_update_url": "https://edmcman.github.io/LinkHints/update.xml" }
```

Creating the directory and file normally requires administrator privileges. Make sure Chrome can read the file and traverse its parent directories. Restart Chrome and check `chrome://extensions`; Chrome will check the feed for later updates. See [Chrome's Linux installation instructions](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions#preferences).

For publication, configure GitHub Pages to use GitHub Actions at the URL above. Set the Actions secret `CHROME_KEY_PEM` to the base64-encoded persistent PEM private key, and set the Actions variable `CHROME_EXTENSION_ID` to the output of `node scripts/publish-chrome.cjs id path/to/key.pem`. Keep the private key safe: changing it changes the extension ID and requires users to install again. The workflow refuses to publish if the key or ID is missing or does not match.
