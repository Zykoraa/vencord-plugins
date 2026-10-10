import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { runInNewContext } from "node:vm";

// Like the plugins' build, these integration tests use Vencord's esbuild.
const requireVencord = createRequire(join(process.env.VENCORD_PATH || join(homedir(), "Vencord"), "package.json"));
const { build } = requireVencord("esbuild");

async function harness() {
    const events: any[] = [];
    let snapshot: any = {
        state: "playing", position: 20, duration: 180,
        track: { path: "spotify:track:test", title: "A song", artist: "An artist" }
    };
    let nextTick: (() => Promise<void>) | undefined;
    const mocks: Record<string, string> = {
        "@api/Settings": `export function definePluginSettings(def) {
            return {store:Object.fromEntries(Object.entries(def).map(([key,value])=>
                [key,value.default ?? value.options?.find(o=>o.default)?.value]))};
        }`,
        "@utils/types": "export default x=>x; export const OptionType={SELECT:1,BOOLEAN:2};",
        "@vencord/discord-types/enums": `export const ActivityFlags={INSTANCE:1},
            ActivityStatusDisplayType={NAME:0},ActivityType={LISTENING:2};`,
        "@webpack/common": `export const ApplicationAssetUtils={fetchAssetIds:async(_,keys)=>keys.map(key=>key.includes("/assets/motif.png")?"logo":"cover")},
            AuthenticationStore={getId:()=>"self"},
            PresenceStore={getActivities:()=>[{type:2,name:"Spotify"}]},
            FluxDispatcher={dispatch:e=>events.push(e)};`
    };
    const bundle = await build({
        entryPoints: [new URL("../eveampPresence/index.tsx", import.meta.url).pathname],
        bundle: true, write: false, platform: "node", format: "cjs",
        plugins: [{ name: "discord-mocks", setup(b: any) {
            b.onResolve({ filter: /^@/ }, ({ path }: any) => ({ path, namespace: "discord-mock" }));
            b.onLoad({ filter: /.*/, namespace: "discord-mock" }, ({ path }: any) => ({ contents: mocks[path] }));
        } }]
    });
    const context: any = {
        module: { exports: {} }, events, Date,
        VencordNative: { pluginHelpers: { EveampPresence: {
            eveampState: async () => snapshot, eveampDisconnect: async () => {}
        } } },
        setTimeout: (fn: () => Promise<void>) => { nextTick = fn; return 1; },
        clearTimeout: () => { nextTick = undefined; }
    };
    runInNewContext(bundle.outputFiles[0].text, context);
    const plugin = context.module.exports.default;
    const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
    return { plugin, events, settle, context,
        update: (patch: any) => { snapshot = { ...snapshot, ...patch }; },
        pause: () => { snapshot = { ...snapshot, state: "paused" }; },
        poll: async () => { await nextTick?.(); await settle(); }
    };
}

it("publishes the player's listening card even when native Spotify is present, then clears on pause", async () => {
    const h = await harness();
    h.plugin.start();
    await h.settle();
    const activity = h.events.at(-1)?.activity;
    assert.ok(activity, "the default must not step aside for Spotify");
    assert.equal(activity.name, "Motif");
    assert.equal(activity.type, 2);
    assert.equal(activity.status_display_type, 0, "show the player's name in the member list");
    assert.equal(activity.details, "A song");
    assert.equal(activity.state, "An artist");
    assert.equal(activity.assets.large_image, "logo", "show Motif when there is no cover");
    assert.equal(activity.timestamps.end - activity.timestamps.start, 180000);

    const replacement = h.plugin.patches[0].replacement;
    const method = "shouldShowActivity(){return true;}".replace(replacement.match,
        replacement.replace.replaceAll("$self", "Vencord.Plugins.plugins.EveampPresence"));
    h.context.Vencord = { Plugins: { plugins: { EveampPresence: h.plugin } } };
    const spotify = runInNewContext(`({${method}})`, h.context);
    assert.equal(spotify.shouldShowActivity(), false, "hide only the duplicate native card");

    h.pause();
    await h.poll();
    assert.equal(h.events.at(-1)?.activity, null);
    assert.equal(spotify.shouldShowActivity(), true, "restore native behavior after pause");
    h.plugin.stop();
});

it("refreshes album art settings while the same song keeps playing", async () => {
    const h = await harness();
    h.update({ track: { path: "spotify:track:test", title: "A song", artist: "An artist", album_art_url: "https://example.org/cover.png" } });
    h.plugin.start();
    await h.settle();
    assert.equal(h.events.at(-1)?.activity.assets.large_image, "cover");
    assert.equal(h.events.at(-1)?.activity.assets.small_image, "logo");
    assert.equal(h.events.at(-1)?.activity.assets.small_text, "Motif");
    h.plugin.settings.store.showAlbumArt = false;
    await h.poll();
    assert.equal(h.events.at(-1)?.activity.assets.large_image, "logo");
    assert.equal(h.events.at(-1)?.activity.assets.small_image, undefined);
    h.plugin.settings.store.showAlbumArt = true;
    await h.poll();
    assert.equal(h.events.at(-1)?.activity.assets.large_image, "cover");
    h.plugin.stop();
});

it("still allows an explicit preference for the native Spotify card", async () => {
    const h = await harness();
    h.plugin.settings.store.hideWithSpotify = true;
    h.plugin.start();
    await h.settle();
    assert.equal(h.events.length, 0);
    assert.equal(h.plugin.ownsSpotifyPresence(), false);
    h.plugin.stop();
});
