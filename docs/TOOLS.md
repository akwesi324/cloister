# Tools

The authoritative lists are the files in [guest/cloister/tools](../guest/cloister/tools). Lines starting with `pipx:` are Python tools installed in their own environments.

A tool that is not packaged for your CPU or release is skipped, never failing the build. Run `cl missing <compartment>` to see which tools were skipped.

## pentest (Kali, red)

| Area | Tools |
|---|---|
| Recon | nmap, masscan, rustscan, amass, theHarvester, recon-ng, dnsrecon, dnsenum, whatweb, nuclei, subfinder, httpx |
| Web | Burp Suite CE, OWASP ZAP, sqlmap, nikto, gobuster, ffuf, feroxbuster, wfuzz, dirb, wpscan, commix |
| Exploitation / AD | Metasploit, searchsploit (exploitdb), Impacket, NetExec, evil-winrm, Responder, BloodHound + bloodhound.py, enum4linux-ng, smbmap, smbclient, ldap-utils, mimikatz (Windows binaries), chisel, ligolo-ng, proxychains4, socat, netcat |
| Passwords | hydra, John the Ripper, hashcat, hashid, crunch, CeWL, SecLists, wordlists |
| Wireless / traffic | aircrack-ng, Wireshark, tcpdump, bettercap |
| RE | gdb, radare2 |

Note: wireless attacks need a USB Wi-Fi adapter passed through to the VM, which is not set up by default.

## soc (Kali, orange)

| Area | Tools |
|---|---|
| Network security monitoring | Zeek, Suricata, tshark/Wireshark, tcpdump, tcpflow, ngrep, nfdump, argus |
| Windows logs & detection | Chainsaw, sigma-cli, python-evtx, YARA |
| Threat intel & decoding | CyberChef (offline), PyMISP, whois, dig |
| Logs | lnav, multitail, ripgrep, jq |

### Optional SIEM stack

Elastic or Wazuh need 4 GB or more of RAM on their own, so they are not installed by default. On a machine with 16 GB or more you can:

```sh
cl net soc direct
cl term soc
# then follow Elastic's or Wazuh's Debian install guide inside the soc compartment
```

## forensics (Kali, purple, offline by default)

| Area | Tools |
|---|---|
| Acquisition | dc3dd, dcfldd, Guymager, ewf-tools (E01), afflib, xmount |
| File systems & carving | The Sleuth Kit, Autopsy, foremost, scalpel, bulk_extractor, TestDisk/PhotoRec, magicrescue, extundelete, ext4magic, dislocker (BitLocker), hashdeep, ssdeep |
| Memory | Volatility 3 |
| Timelines & artefacts | Plaso (log2timeline), RegRipper, rifiuti2, chntpw, ExifTool, DB Browser for SQLite, oletools, pdfid, pdf-parser |
| Malware / binaries | YARA, binwalk, Ghidra, radare2, UPX, strace, ltrace |
| Hex | hexedit, GHex |

Evidence handling: bring images in with `cl copy` or attach them as read-only disks, and hash on intake (`hashdeep`, `dc3dd hash=`). The compartment has no network unless you run `cl net forensics direct`; switch it back to `none` afterwards.

## vault (Debian, black, never networked)

KeePassXC, GnuPG, age, a text editor.

## Disposable (grey)

Firefox ESR, MuPDF, Ristretto, Mousepad, `file`, `xxd`, `strings`, ExifTool, YARA, pdfid, oletools, 7-Zip.
