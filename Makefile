.PHONY: watch-bp watch-text

public/bundle.js: *.ts lib/*.ts lib/stores/*.ts
	npx browserify -t unassertify -p tsify -g uglifyify client.ts > $@

watch-bp:
	npx watchify -v -p tsify demos/bp/browserclient/index.ts -o demos/bp/public/bundle.js

watch-text:
	npx watchify -v -p tsify demos/text/editor.ts -o demos/text/public/bundle.js
