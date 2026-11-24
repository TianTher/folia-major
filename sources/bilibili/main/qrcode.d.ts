// sources/bilibili/main/qrcode.d.ts
// The two members of `qrcode` this mod uses; the package ships no types of its own and only the main entry needs it.

declare module 'qrcode' {
    /** A PNG data URL of `text`, drawn at the default scale. */
    export function toDataURL(text: string): Promise<string>;
}
