# Statecraft file store

This provides a simple store which watches a JSON file and exposes the file's contents as a store.

All writes replace the entire contents of the file (so its really not efficient), but it works great for managing application configuration.
