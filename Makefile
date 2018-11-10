.PHONY: watch

public/bundle.js: *.ts lib/*.ts lib/stores/*.ts
	npx browserify -t unassertify -p tsify -g uglifyify client.ts > $@

watch:
	npx watchify -v -p tsify demos/bp/browserclient/main.ts -o demos/bp/public/bundle.js
