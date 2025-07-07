from dataclasses import dataclass
from typing import Optional, List
from datetime import datetime

@dataclass
class Deficiency:
    deficiency_id: Optional[str] = ""
    status: Optional[str] = ""
    reported_on: Optional[datetime] = None
    address: Optional[str] = ""
    location_name: Optional[str] = ""
    is_monthly_access: Optional[bool] = False
    description: Optional[str] = ""
    proposed_solution: Optional[str] = ""
    company: Optional[str] = ""
    tech_name: Optional[str] = ""
    tech_image_link: Optional[str] = ""
    job_link: Optional[str] = ""
    is_job_complete: Optional[bool] = False
    job_id: Optional[int] = None
    service_line_name: Optional[str] = ""
    service_line_icon_link: Optional[str] = ""
    severity: Optional[str] = ""
    is_quote_sent: Optional[bool] = False
    is_quote_approved: Optional[bool] = False
    is_quote_in_draft: Optional[bool] = False
    quote_expiry: Optional[datetime] = None

    def __str__(self):
        return (
            f"Deficiency Report\n"
            f"---------------------------\n"
            f"Deficiency ID: {self.deficiency_id}\n"
            f"Status: {self.status}\n"
            f"Reported On: {self.reported_on.strftime('%Y-%m-%d') if self.reported_on else 'N/A'}\n"
            f"Address: {self.address or 'N/A'}\n"
            f"Location Name: {self.location_name or 'N/A'}\n"
            f"Monthly Access: {'Yes' if self.is_monthly_access else 'No'}\n"
            f"Severity: {self.severity or 'N/A'}\n"
            f"\n"
            f"Description: {self.description or 'N/A'}\n"
            f"Proposed Solution: {self.proposed_solution or 'N/A'}\n"
            f"\n"
            f"Company: {self.company or 'N/A'}\n"
            f"Reported By: {self.tech_name or 'N/A'}\n"
            f"Reporter Image: {self.tech_image_link or 'N/A'}\n"
            f"Job Link: {self.job_link or 'N/A'}\n"
            f"Job Id: {self.job_id or 'N/A'}\n"
            f"Is Job Complete: {self.is_job_complete or 'N/A'}\n"
            f"Service Line: {self.service_line_name or 'N/A'}\n"
            f"Service Icon: {self.service_line_icon_link or 'N/A'}"
        )
