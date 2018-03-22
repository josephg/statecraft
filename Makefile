.PHONY: watch

public/bundle.js: *.ts lib/*.ts lib/stores/*.ts
	npx browserify -t unassertify -p tsify client.ts > $@

watch:
	watchify -v -p tsify client.ts -o public/bundle.js
