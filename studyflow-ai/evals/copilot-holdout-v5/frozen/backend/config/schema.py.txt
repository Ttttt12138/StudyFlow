import re
from drf_spectacular.openapi import AutoSchema

class StudyFlowSchema(AutoSchema):
    def get_operation_id(self):
        return self.method.lower() + "_" + re.sub(r"[^a-zA-Z0-9]+", "_", self.path).strip("_")

    def get_response_serializers(self):
        from finance.workflow_api import ReadView, ResourceView
        from finance.lending_api import AccountView
        from finance.workflow_serializers import CommandResponse, HistoryResponse
        if self.method == "GET" and isinstance(self.view, (ReadView, ResourceView, AccountView)):
            return CommandResponse if "{" in self.path else HistoryResponse
        return super().get_response_serializers()
