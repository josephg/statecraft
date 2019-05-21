# Monitor Demo

This is a simple demo showing how statecraft can be used in a devops context.

There's 2 processes:

- The core server, which hosts a simple website showing a dashboard
- A worker process which is installed on each client, that connects to the dashboard.

To run this demo:

- In one tab start the monitoring dashboard with `yarn start`
- In another terminal, run `yarn run monitor`. You can also run this from another machine by setting the `HOST` environment variable to point to the machine running the dashboard.

The server will listen for connections. Monitors can connect to the server and stream information about CPU usage.