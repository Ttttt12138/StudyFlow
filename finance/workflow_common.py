from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError
from .models import FinancialState, AuditEvent
from .services import VersionConflict, json_value

def require(condition,message):
    if not condition: raise ValidationError({"detail":message})

def owned(model,owner,pk):
    return get_object_or_404(model,owner=owner,pk=pk)

def current(owner,version=None):
    state = FinancialState.objects.filter(owner=owner).first()
    require(state is not None,"Confirm financial state first.")
    if version is not None and state.version != version: raise VersionConflict()
    return state

def audit(owner,actor,action,obj,details=None):
    AuditEvent.objects.create(owner=owner,action=action,entity_id=obj.id,
        details={"actor_id":actor.pk,**(details or {})})

def append_state(owner,snapshot,actor,reason):
    state = current(owner)
    revision = FinancialState.objects.create(owner=owner,version=state.version+1,snapshot=json_value(snapshot))
    audit(owner,actor,reason,revision,{"version":revision.version})
    return revision

def record(obj):
    data = {}
    for field in obj._meta.fields:
        if field.name in {"owner","id"}: continue
        data[field.name] = getattr(obj,field.attname)
    if obj.__class__.__module__ in {"finance.workflow_models", "finance.lending_models"}:
        data["is_simulated"] = True
    return {"id":str(obj.id),"type":obj._meta.model_name,**json_value(data)}

def shift_date(value, days):
    from datetime import timedelta
    try:
        return value + timedelta(days=days)
    except OverflowError:
        require(False, "Date plus settlement delay is outside the supported calendar.")
