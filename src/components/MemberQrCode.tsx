import QRCode from "qrcode";

export default async function MemberQrCode({ memberId }: { memberId: string }) {
  const dataUrl = await QRCode.toDataURL(`RCL:${memberId}`, {
    margin: 1,
    width: 220,
    color: { dark: "#14110c", light: "#f8f5ec" },
  });
  // eslint-disable-next-line @next/next/no-img-element -- generated data URL, not an optimizable remote/static asset
  return <img src={dataUrl} alt="Your Insiders member QR code" width={220} height={220} className="rounded-lg" />;
}
