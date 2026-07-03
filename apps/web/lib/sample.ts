/**
 * Deliberately messy sample CRM export for the "Try sample data" button.
 * Every engine rule fires on this data: whitespace, duplicates, blank rows,
 * casing, mixed dates, emails, phones, postcodes, mojibake ("Oâ€™Brien",
 * "CafÃ©"), stripped leading zeros (Account No), and an outlier (Spend).
 */
export const SAMPLE_DATA = `Name,Email,Phone,Postcode,Joined,Company,Account No,Spend
John Smith,john.smith@acme.com,07700 900123,SW1A 1AA,2024-01-15,Acme Ltd,00101,249.50
  jane doe ,Jane.Doe@ACME.com,+44 7700 900456,sw1a2bb,15/01/2024,ACME LTD,00102,180
John Smith,john.smith@acme.com,07700 900123,SW1A 1AA,2024-01-15,Acme Ltd,00101,249.50
Bob  Jones,bob@@broken.email,12345,ZZ99 9ZZ,31/02/2024,acme ltd,103,320.75
,,,,,,,
Ann Lee,ann@lee.co.uk,020 7946 0999,EC1A1BB,"Apr 3, 2024",CafÃ© Lee & Co,00105,99999
SARAH CONNOR,sarah.connor@sky.net,07700900789,m1 1ae,03/04/2024,Cyberdyne Systems,00106,275
sarah connor,Sarah.Connor@sky.net,+447700900789,M1 1AE,4 Mar 2024,Cyberdyne Systems,107,410.25
Mike Oâ€™Brien,mike.obrien@lee.co.uk,0161 496 0100,M2 5DB,2024-02-30,Lee & Co,00108,290
Priya Patel,priya@patel.io,07700 900321,B33 8TH,12/06/2024,"Patel, Sons & Co",00109,150
priya patel,priya@patel.io,07700 900321,B33 8TH,12/06/2024,"Patel, Sons & Co",00109,150
Tom Wright,tom.wright,07700 900654,LS1 4AP,2024-05-20,Wright Logistics,00110,205
Emma Stone,emma@stone.dev,555-0100,90210,20/05/2024,Stone Development,111,340
`;
