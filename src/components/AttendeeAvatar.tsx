import React, { useState } from "react";

type AvatarProps = { name: string; url?: string; className?: string };
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join("").toUpperCase() || "?";

const AttendeeAvatar = ({ name, url, className = "" }: AvatarProps) => {
    const [failedUrl, setFailedUrl] = useState("");
    if (!url || failedUrl === url) {
        return <span className={`avatar-fallback ${className}`} role="img" aria-label={`${name} initials`}>{initials(name)}</span>;
    }
    return <img className={className} src={url} alt={`${name} avatar`} onError={() => setFailedUrl(url)} />;
};

export default AttendeeAvatar;
