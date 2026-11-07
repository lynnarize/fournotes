# Four Notes

Notes, to-dos and spending in one app, with an assistant that files things for you.

| Folder | What it is |
| --- | --- |
| [`web/`](web) | The web app ([app.fournotes.xyz](https://app.fournotes.xyz)): Next.js, Supabase sync |
| [`macos/`](macos) | The native Mac app: SwiftUI and AppKit |
| [`website/`](website) | The marketing site ([fournotes.xyz](https://www.fournotes.xyz)): static HTML |

Each folder has its own README with how to run and build it.

## Releases

Mac releases are tagged `macos-v<version>` and published on this repository's
[Releases](https://github.com/lynnarize/fournotes/releases) page by
`macos/scripts/release.sh`. The app, the website and the web app all read the latest
release from here.

## History

This repository combines two earlier ones: the web app (this repository, which was
called `fournotes-web-apps` for a while) and
[lynnarize/fournotes-macos](https://github.com/lynnarize/fournotes-macos). Both histories
are kept: `git log --follow` on a file shows its commits from before the move.
Earlier releases (up to 0.5.0 beta) are also still on fournotes-macos.

## License

Each app is dual-licensed under MIT and Apache 2.0; see the `LICENSE-*` files in its
folder.
