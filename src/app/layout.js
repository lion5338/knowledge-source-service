import "./globals.css";

export const metadata = {
  title: "Knowledge Source Service",
  description: "Source and artifact API for Question Generation knowledge.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
