# uSEQ Perform
![alt text](https://i.postimg.cc/LsgnqS6k/Screenshot-from-2025-04-10-19-18-59.png)

The official browser-based code editor for the Emute Lab Instruments live coding sequencer.

Live at:
- [https://useq.emutelabinstruments.co.uk](https://useq.emutelabinstruments.co.uk) (stable version)
- [https://useq.emutelabinstruments.co.uk/preview](https://useq.emutelabinstruments.co.uk/preview) (preview of upcoming versions)

## Build and Run

`npm run build` builds the application to `public/bundle.js`, along with a sourcemap file for debugging.

`npm start` launches a server, using [serve](https://github.com/zeit/serve). 

`npm run watch` will continually rebuild the application as your source files change.

`npm run dev` will run `npm start` and `npm run watch` in parallel.

## Url parameters

**nosave** don't load or save with local storage 
**gist=<url>** load from a gist

## License

[MIT](LICENSE).
