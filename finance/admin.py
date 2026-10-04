from django.contrib import admin
from .models import SourceDocument, FinancialState, CalculationRun, AuditEvent

class ReadOnlyAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return False
    def has_change_permission(self, request, obj=None):
        return False
    def has_delete_permission(self, request, obj=None):
        return False

for model in (SourceDocument, FinancialState, CalculationRun, AuditEvent):
    admin.site.register(model, ReadOnlyAdmin)
