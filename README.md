# Chat Polish

A [Paseo](https://paseo.sh) plugin that redraws the agent chat as one quiet column, adds the One Dark Darker Mariana theme, and gives you a dashboard to tune it all with a live preview.

![The dashboard's Theme page](images/theme.png)

## What it does

- **Tool calls as single rows.** An icon, a verb that shows the state (Running, Ran), the command or file, and a short detail. Open a row for its diff, output or raw input and output. Failed calls turn red.
- **Steps merged between replies.** The thoughts and tool calls before an answer fold into one row, such as "Edited 1 file and ran 1 command", which opens to each step.
- **Themes.** Pick one of Paseo's built-in themes or a Chat Polish one (Mariana, Paper, Dusk), or edit the colors with contrast checks. Fonts and sizes are set from the same page.
- **Rich text styles.** Three or four looks each for quotes, tables, code blocks, inline code, headings, lists, callouts and rules.
- **Working indicator.** Paseo's dots, or a sparkle, spokes, dot ring, orb, matrix or snake loader.
- **Extras.** Turn recaps, ⌥⌘↑/↓ to jump between your prompts, and Command Center (⌘K) toggles.

![Merged steps, a diff and a shell run in the chat](images/chat.png)

## Dashboard

Open **Chat Polish** in the sidebar. Every page has a live preview, and changes save as you pick.

| Messages | Rich text |
| --- | --- |
| ![Messages page with loader tiles](images/messages.png) | ![Rich text page with style tiles](images/rich-text.png) |

The Theme page previews code too. The Code tab draws the same rows the chat uses:

<img src="images/code-preview.png" alt="Code preview" width="520">

## Install

Requires Paseo 0.11.2 or later.

```sh
paseo plugin add lthieu96/chat-polish
```

Install directly from GitHub instead:

```sh
paseo plugin add github:lthieu96/paseo-chat-polish
```

To install a specific GitHub release, pass its tag, such as `--ref v0.1.0`.

## Update

The dashboard sidebar shows **Update available** when a newer revision is available. Press **Update** and Paseo installs it and restarts the plugin. From a terminal:

```sh
paseo plugin update paseo-chat-polish
```

Registry installs use the revision approved for the listing. Direct GitHub installs update from the repository's default branch.

## Release

Update the version in `package.json` and `package-lock.json`, commit it, then push a matching tag. The workflow typechecks and tests the plugin, then creates a GitHub Release with generated notes:

```sh
git tag v0.1.1
git push origin v0.1.1
```

To update the Paseo Registry listing, submit the new GitHub tag as a revision through the [plugin submission form](https://github.com/getpaseo/plugins/issues/new?template=submit-plugin.yml). Registry updates are reviewed before users receive the new revision.

## Limitations

- Restyling Paseo's own items, the font settings and the app theme picker work on desktop and web only.
- Fonts, theme picks and the restyle write Paseo's own settings and DOM, which aren't a public API and may change.
- Previews of Paseo's built-in themes and font stacks are copied from Paseo 0.11.2 and can drift in later versions.
- Plain tool rows need Settings → Appearance → Tool call display set to Detailed; Summary keeps Paseo's grouped calls.

## Develop

```sh
npm install
npm run typecheck
npm test
paseo plugin install .              # once, from this directory
paseo plugin reload paseo-chat-polish
```

Designs live in `design/dashboard.pen` (open it with [pen.dev](https://pen.dev)).

## License

MIT
