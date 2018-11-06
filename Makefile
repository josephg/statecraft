.PHONY: watch

public/bundle.js: *.ts lib/*.ts lib/stores/*.ts
	npx browserify -t unassertify -p tsify -g uglifyify client.ts > $@

watch:
	npx watchify -v -p tsify lib/net/browserclient/main.ts -o public/bundle.js
