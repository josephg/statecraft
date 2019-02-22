.PHONY: all clean watch-bp watch-text watch-bidirectional

all: demos/text/public/bundle.js
clean:
	rm demos/*/public/bundle.js


demos/text/public/bundle.js: demos/text/*.ts lib/*.ts lib/*/*.ts
	npx browserify -p tsify -p tinyify demos/text/editor.ts -o $@

watch-bp:
	npx watchify -v -p tsify demos/bp/browserclient/index.ts -o demos/bp/public/bundle.js

watch-text:
	npx watchify -v -p tsify demos/text/editor.ts -o demos/text/public/bundle.js

demos/bidirectional/public/bundle.js: demos/bidirectional/*.ts lib/*.ts lib/*/*.ts
	npx browserify  -p tsify -p tinyify demos/bidirectional/client.ts -o $@

watch-bidirectional:
	npx watchify -v -p tsify demos/bidirectional/client.ts -o demos/bidirectional/public/bundle.js
